// backend/server.js
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { fileTypeFromFile } from 'file-type';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const UPLOADS_DIR = path.join(ROOT, 'uploads');
const USERS_FILE = path.join(UPLOADS_DIR, 'users.json');

fs.mkdirSync(PUBLIC_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2));
}

// ---------- helpers ----------
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024, sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}
function clientIp(req) {
    const fwd = req.headers['x-forwarded-for'];
    return (typeof fwd === 'string' && fwd.split(',')[0].trim()) || req.ip;
}

// ---------- helpers: users ----------
async function readUsers() {
    const buf = await fsp.readFile(USERS_FILE, 'utf8');
    return JSON.parse(buf);
}
async function writeUsers(arr) {
    await fsp.writeFile(USERS_FILE, JSON.stringify(arr, null, 2));
}
function userDir(userId) {
    return path.join(UPLOADS_DIR, userId);
}
function userAlbumsFile(userId) {
    return path.join(userDir(userId), 'albums.json');
}
async function ensureUser(userId) {
    const dir = userDir(userId);
    await fsp.mkdir(dir, { recursive: true });
    const albumsPath = userAlbumsFile(userId);
    try { await fsp.access(albumsPath); } catch { await fsp.writeFile(albumsPath, JSON.stringify([], null, 2)); }
}

// ---------- helpers: albums per user ----------
async function readAlbums(userId) {
    await ensureUser(userId);
    const buf = await fsp.readFile(userAlbumsFile(userId), 'utf8');
    return JSON.parse(buf);
}
async function writeAlbums(userId, arr) {
    await ensureUser(userId);
    await fsp.writeFile(userAlbumsFile(userId), JSON.stringify(arr, null, 2));
}
function albumDir(userId, albumId) {
    return path.join(userDir(userId), albumId);
}
function albumMetaPath(userId, albumId) {
    return path.join(albumDir(userId, albumId), 'metadata.json');
}
async function ensureAlbum(userId, albumId) {
    const dir = albumDir(userId, albumId);
    await fsp.mkdir(dir, { recursive: true });
    const metaPath = albumMetaPath(userId, albumId);
    try { await fsp.access(metaPath); } catch { await fsp.writeFile(metaPath, JSON.stringify([], null, 2)); }
}
async function readAlbumMeta(userId, albumId) {
    await ensureAlbum(userId, albumId);
    const buf = await fsp.readFile(albumMetaPath(userId, albumId), 'utf8');
    return JSON.parse(buf);
}
async function writeAlbumMeta(userId, albumId, arr) {
    await ensureAlbum(userId, albumId);
    await fsp.writeFile(albumMetaPath(userId, albumId), JSON.stringify(arr, null, 2));
}

const app = express();
const PORT = process.env.PORT || 3999;

app.use(cors());
app.use(express.json());
app.use(express.static(PUBLIC_DIR));
app.use('/uploads', express.static(UPLOADS_DIR));

// ---------- multer storage (user + album) ----------
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        try {
            const { userId, albumId } = req.params;
            const dir = albumDir(userId, albumId);
            fs.mkdirSync(dir, { recursive: true });
            const metaPath = albumMetaPath(userId, albumId);
            if (!fs.existsSync(metaPath)) fs.writeFileSync(metaPath, '[]');
            cb(null, dir);
        } catch (err) {
            cb(err);
        }
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname || '.jpg');
        cb(null, `${uuidv4()}${ext}`);
    }
});

const upload = multer({
    storage,
    // quick header-based guard (can be spoofed, but catches most)
    fileFilter: (req, file, cb) => {
        const ok = /image\/(jpeg|png|webp|gif|heic|heif)/i.test(file.mimetype);
        if (!ok) return cb(new Error('Only image files are allowed (jpeg/png/webp/gif/heic)'));
        cb(null, true);
    },
    limits: { fileSize: 1 * 1024 * 1024 * 1024, files: 250 } // 1GB per file
});

// =================== USERS ===================

// List users with album counts
app.get('/api/users', async (req, res) => {
    const users = await readUsers();
    const enriched = await Promise.all(users.map(async u => {
        const albums = await readAlbums(u.id);
        return { id: u.id, name: u.name, albumCount: albums.length, createdAt: u.createdAt };
    }));
    res.json(enriched);
});

// Create a user
app.post('/api/users', async (req, res) => {
    const name = (req.body?.name || '').toString().trim().slice(0, 60);
    if (!name) return res.status(400).json({ error: 'User name required' });

    const users = await readUsers();
    const id = uuidv4();
    const user = { id, name, createdAt: new Date().toISOString() };
    users.unshift(user);
    await writeUsers(users);
    await ensureUser(id);

    console.log(`[USER CREATE] ip=${clientIp(req)} user="${name}" id=${id}`);
    res.status(201).json(user);
});

// Delete user only if no albums
app.delete('/api/users/:userId', async (req, res) => {
    const { userId } = req.params;
    const users = await readUsers();
    const idx = users.findIndex(u => u.id === userId);
    if (idx === -1) return res.status(404).json({ error: 'User not found' });

    const albums = await readAlbums(userId);
    if (albums.length > 0) return res.status(400).json({ error: 'User has albums' });

    try { await fsp.rm(userDir(userId), { recursive: true, force: true }); } catch { }
    const removed = users.splice(idx, 1)[0];
    await writeUsers(users);

    console.log(`[USER DELETE] ip=${clientIp(req)} user="${removed?.name || userId}" id=${userId}`);
    res.json({ ok: true });
});

// =================== ALBUMS (per user) ===================

// List albums for a user
app.get('/api/users/:userId/albums', async (req, res) => {
    const { userId } = req.params;
    const users = await readUsers();
    if (!users.find(u => u.id === userId)) return res.status(404).json({ error: 'User not found' });

    const albums = await readAlbums(userId);
    const withCounts = await Promise.all(albums.map(async a => {
        const meta = await readAlbumMeta(userId, a.id);
        return { id: a.id, name: a.name, count: meta.length, createdAt: a.createdAt };
    }));
    res.json(withCounts);
});

// Create album under a user
app.post('/api/users/:userId/albums', async (req, res) => {
    const { userId } = req.params;
    const users = await readUsers();
    if (!users.find(u => u.id === userId)) return res.status(404).json({ error: 'User not found' });

    const name = (req.body?.name || '').toString().trim().slice(0, 60);
    if (!name) return res.status(400).json({ error: 'Album name required' });

    const albums = await readAlbums(userId);
    const id = uuidv4();
    const album = { id, name, createdAt: new Date().toISOString() };
    albums.unshift(album);
    await writeAlbums(userId, albums);
    await ensureAlbum(userId, id);

    console.log(`[ALBUM CREATE] ip=${clientIp(req)} album="${name}" id=${id}`);
    res.status(201).json(album);
});

// Delete album (only if empty)
app.delete('/api/users/:userId/albums/:albumId', async (req, res) => {
    const { userId, albumId } = req.params;
    const albums = await readAlbums(userId);
    const idx = albums.findIndex(a => a.id === albumId);
    if (idx === -1) return res.status(404).json({ error: 'Album not found' });

    const meta = await readAlbumMeta(userId, albumId);
    if (meta.length > 0) return res.status(400).json({ error: 'Album is not empty' });

    try { await fsp.rm(albumDir(userId, albumId), { recursive: true, force: true }); } catch { }
    const removed = albums.splice(idx, 1)[0];
    await writeAlbums(userId, albums);

    console.log(`[ALBUM DELETE] ip=${clientIp(req)} album="${removed?.name || albumId}" id=${albumId}`);
    res.json({ ok: true });
});

// =================== PHOTOS (per user + album) ===================

app.get('/api/users/:userId/albums/:albumId/photos', async (req, res) => {
    const { userId, albumId } = req.params;
    const albums = await readAlbums(userId);
    if (!albums.find(a => a.id === albumId)) return res.status(404).json({ error: 'Album not found' });

    const meta = await readAlbumMeta(userId, albumId);
    const out = [];
    for (const m of meta) {
        const filePath = path.join(albumDir(userId, albumId), m.filename);
        if (fs.existsSync(filePath)) {
            out.push({
                id: m.id,
                url: `/uploads/${userId}/${albumId}/${m.filename}`,
                caption: m.caption || '',
                uploadedAt: m.uploadedAt
            });
        }
    }
    res.json(out);
});

// STRICT IMAGE VALIDATION + LOGGING
app.post('/api/users/:userId/albums/:albumId/upload', upload.array('photos', 250), async (req, res) => {
    try {
        const { userId, albumId } = req.params;
        const albums = await readAlbums(userId);
        if (!albums.find(a => a.id === albumId)) return res.status(404).json({ error: 'Album not found' });
        if (!Array.isArray(req.files) || req.files.length === 0) {
            return res.status(400).json({ error: 'No files uploaded' });
        }

        // Logging: who, what, how big
        const totalBytes = req.files.reduce((sum, f) => sum + (f.size || 0), 0);
        console.log(`[UPLOAD START] ip=${clientIp(req)} albumId=${albumId} files=${req.files.length} size=${formatBytes(totalBytes)}`);

        const caption = (req.body.caption || '').toString().slice(0, 300);
        const meta = await readAlbumMeta(userId, albumId);
        const created = [];

        for (const f of req.files) {
            const absPath = f.path;

            // Content-based detection
            let detected;
            try { detected = await fileTypeFromFile(absPath); } catch { }
            if (!detected || !detected.mime || !detected.mime.startsWith('image/')) {
                try { await fsp.unlink(absPath); } catch { }
                console.warn(`[UPLOAD REJECT] ip=${clientIp(req)} albumId=${albumId} file="${f.originalname}" reason=not_image`);
                return res.status(400).json({ error: `Only image files are allowed. Rejected: ${f.originalname}` });
            }

            const ALLOWED_IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif']);
            const ext = (detected.ext || '').toLowerCase();
            if (!ALLOWED_IMAGE_EXTS.has(ext)) {
                try { await fsp.unlink(absPath); } catch { }
                console.warn(`[UPLOAD REJECT] ip=${clientIp(req)} albumId=${albumId} file="${f.originalname}" mime=${detected.mime} reason=unsupported_type`);
                return res.status(400).json({ error: `Unsupported image type (${detected.mime}). Allowed: ${[...ALLOWED_IMAGE_EXTS].join(', ')}` });
            }

            // Normalize extension if needed
            const currentExt = path.extname(absPath).slice(1).toLowerCase();
            let finalFilename = path.basename(absPath);
            if (currentExt !== ext) {
                const newName = `${uuidv4()}.${ext}`;
                const newPath = path.join(path.dirname(absPath), newName);
                await fsp.rename(absPath, newPath);
                finalFilename = newName;
            }

            const id = uuidv4();
            const record = { id, filename: finalFilename, caption, uploadedAt: new Date().toISOString() };
            meta.unshift(record);
            created.push({ id, url: `/uploads/${userId}/${albumId}/${finalFilename}`, caption: record.caption });

            console.log(`[UPLOAD FILE] ip=${clientIp(req)} albumId=${albumId} saved="${finalFilename}" size=${formatBytes(f.size || 0)} mime=${detected.mime}`);
        }

        await writeAlbumMeta(userId, albumId, meta);
        console.log(`[UPLOAD DONE] ip=${clientIp(req)} albumId=${albumId} created=${created.length} totalSize=${formatBytes(req.files.reduce((s, f) => s + (f.size || 0), 0))}`);

        res.status(201).json({ ok: true, created, count: created.length });
    } catch (err) {
        console.error('[UPLOAD ERROR]', err);
        res.status(500).json({ error: 'Upload failed' });
    }
});

app.delete('/api/users/:userId/albums/:albumId/photos/:photoId', async (req, res) => {
    try {
        const { userId, albumId, photoId } = req.params;
        const meta = await readAlbumMeta(userId, albumId);
        const idx = meta.findIndex(m => m.id === photoId);
        if (idx === -1) return res.status(404).json({ error: 'Not found' });

        const filename = meta[idx].filename;
        try { await fsp.unlink(path.join(albumDir(userId, albumId), filename)); } catch { }
        meta.splice(idx, 1);
        await writeAlbumMeta(userId, albumId, meta);

        console.log(`[PHOTO DELETE] ip=${clientIp(req)} photoId=${photoId} file="${filename}"`);
        res.json({ ok: true });
    } catch (e) {
        console.error('[DELETE ERROR]', e);
        res.status(500).json({ error: 'Delete failed' });
    }
});

// error handler (multer/others)
app.use((err, req, res, next) => {
    if (err) {
        console.error('[ERROR HANDLER]', err);
        const status = err.name === 'MulterError' ? 400 : 500;
        return res.status(status).json({ error: err.message || 'Server error' });
    }
    next();
});

// SPA fallback LAST
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Family Photos server running at http://localhost:${PORT}`);
});
