// public/app.js

// --------- elements & templates ----------
const view = document.getElementById('view');
const crumbs = document.getElementById('crumbs');
const primaryBtn = document.getElementById('primaryAction');

const tplUsers = document.getElementById('usersTemplate');
const tplCreateUser = document.getElementById('createUserTemplate');
const tplAlbums = document.getElementById('albumsTemplate');
const tplCreateAlbum = document.getElementById('createAlbumTemplate');
const tplAlbum = document.getElementById('albumTemplate');
const homeBtn = document.getElementById('homeBtn');
homeBtn?.addEventListener('click', () => navigate('#/users'));

(function () {
    const PASSCODE = "162028";
    let entered = sessionStorage.getItem("passcodeOK");

    if (!entered) {
        const code = prompt("Enter access code:");
        if (code === PASSCODE) {
            sessionStorage.setItem("passcodeOK", "true");
        } else {
            alert("Incorrect code. Access denied.");
            window.location.href = "about:blank"; // block them
        }
    }
})();

// --------- API ----------
async function api(path, opts = {}) {
    const res = await fetch(path, opts);
    const text = await res.text();
    if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
    try { return JSON.parse(text); } catch { return text; }
}
const Users = {
    list: () => api('/api/users'),
    create: (name) => api('/api/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name })
    }),
    del: (userId) => api(`/api/users/${userId}`, { method: 'DELETE' })
};
const Albums = {
    list: (userId) => api(`/api/users/${userId}/albums`),
    create: (userId, name) => api(`/api/users/${userId}/albums`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name })
    }),
    del: (userId, albumId) => api(`/api/users/${userId}/albums/${albumId}`, { method: 'DELETE' }),
    photos: (userId, albumId) => api(`/api/users/${userId}/albums/${albumId}/photos`),
    upload: (userId, albumId, formData) => api(`/api/users/${userId}/albums/${albumId}/upload`, { method: 'POST', body: formData }),
    deletePhoto: (userId, albumId, photoId) => api(`/api/users/${userId}/albums/${albumId}/photos/${photoId}`, { method: 'DELETE' })
};

// --------- routing ----------
function parseHash() {
    // #/users | #/users/new | #/user/:userId | #/user/:userId/albums/new | #/user/:userId/album/:albumId
    const cleaned = (location.hash || '#/users').replace(/^#\/?/, '');
    return cleaned.split('/').filter(Boolean);
}
function navigate(hash) {
    if (location.hash === hash) {
        // same hash: manually route once
        route();
        return;
    }
    // different hash: setting it will trigger hashchange -> route()
    location.hash = hash;
}

window.addEventListener('hashchange', route);

function setPrimary(label, handler) {
    primaryBtn.textContent = label;
    primaryBtn.onclick = handler;
}

// --- Gallery helpers ---
const PAGE_SIZE = 20;

function thumbFrom(url) {
    // If you later store thumbs at /thumbs/, this will use them.
    // Otherwise, fallback to the original URL.
    if (!url) return url;
    const swapped = url.replace('/originals/', '/thumbs/');
    return swapped === url ? url : swapped;
}

function makePager() {
    const bar = document.createElement('div');
    bar.className = 'pager';
    const prev = document.createElement('button');
    prev.textContent = 'Prev';
    const info = document.createElement('span');
    info.className = 'pager-info';
    const next = document.createElement('button');
    next.textContent = 'Next';
    bar.append(prev, info, next);
    return { bar, prev, next, info };
}

// --- Lightbox (transparent background, image floats above app) ---
let _lightbox;
function ensureLightbox() {
    if (_lightbox) return _lightbox;

    const overlay = document.createElement('div');
    overlay.className = 'lightbox'; // CSS makes background transparent
    overlay.setAttribute('aria-hidden', 'true');

    const frame = document.createElement('div');
    frame.className = 'lightbox-frame';

    const img = document.createElement('img');
    img.className = 'lightbox-img';
    img.alt = '';

    const cap = document.createElement('div');
    cap.className = 'lightbox-caption';

    frame.appendChild(img);
    frame.appendChild(cap);
    overlay.appendChild(frame);
    document.body.appendChild(overlay);

    let open = false;
    let currentSrc = '';

    function show(src, caption = '') {
        if (open && currentSrc === src) {
            hide();
            return;
        }
        currentSrc = src;
        img.src = src;
        cap.textContent = caption;
        overlay.classList.add('visible');
        overlay.setAttribute('aria-hidden', 'false');
        open = true;
    }
    function hide() {
        overlay.classList.remove('visible');
        overlay.setAttribute('aria-hidden', 'true');
        currentSrc = '';
        open = false;
    }
    // click anywhere closes
    overlay.addEventListener('click', hide);
    // Esc closes
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') hide();
    });

    _lightbox = { show, hide, toggle: show };
    return _lightbox;
}

// --------- views ----------
async function renderUsers() {
    view.innerHTML = '';
    crumbs.textContent = 'Home';
    setPrimary('New User', () => navigate('#/users/new'));

    const node = tplUsers.content.cloneNode(true);
    view.append(node);
    const container = view.querySelector('.users');

    try {
        const users = await Users.list();
        if (!users.length) {
            container.innerHTML = '<p>No users yet. Create one!</p>';
            return;
        }
        users.forEach(u => container.appendChild(userCard(u)));
    } catch {
        container.textContent = 'Could not load users.';
    }
}
function userCard(u) {
    const div = document.createElement('div');
    div.className = 'user-card';
    div.innerHTML = `<h3>${escapeHtml(u.name)}</h3><p>${u.albumCount} album(s)</p>`;
    div.addEventListener('click', (e) => {
        e.preventDefault();
        navigate(`#/user/${u.id}`);
    });
    return div;
}

function renderCreateUser() {
    view.innerHTML = '';
    crumbs.textContent = 'Create User';
    setPrimary('Back to Users', () => navigate('#/users'));

    const node = tplCreateUser.content.cloneNode(true);
    view.append(node);
    const form = document.getElementById('createUserForm');
    const status = document.getElementById('createUserStatus');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = new FormData(form).get('name');
        status.textContent = 'Creating...';
        try {
            const created = await Users.create(name);
            status.textContent = 'Created!';
            navigate(`#/user/${created.id}`);
        } catch (err) {
            status.textContent = 'Create failed: ' + (err?.message || '');
        }
    });
}

async function renderUserAlbums(userId) {
    view.innerHTML = '';
    setPrimary('New Album', () => navigate(`#/user/${userId}/albums/new`));

    // fetch user name for crumbs
    let userName = '';
    try {
        const users = await Users.list();
        const u = users.find(x => x.id === userId);
        userName = u?.name || '';
        crumbs.textContent = u ? `Home > ${u.name}` : 'Albums';
    } catch {
        crumbs.textContent = 'Albums';
    }

    const node = tplAlbums.content.cloneNode(true);
    view.append(node);
    const container = view.querySelector('.albums');

    // ⬇️ Helper to show the delete-user action when no albums exist
    function showDeleteUserAction() {
        const existing = view.querySelector('.user-actions');
        if (existing) existing.remove();

        const actions = document.createElement('div');
        actions.className = 'user-actions';
        const del = document.createElement('button');
        del.className = 'danger';
        del.textContent = 'Delete User';
        del.addEventListener('click', async () => {
            const label = userName ? `"${userName}"` : 'this user';
            if (!confirm(`Delete user ${label}? This cannot be undone.`)) return;
            try {
                await Users.del(userId);
                navigate('#/users');
            } catch (err) {
                alert('Delete failed: ' + (err?.message || ''));
            }
        });

        actions.appendChild(del);
        container.appendChild(actions);
    }

    try {
        const albums = await Albums.list(userId);
        if (!albums.length) {
            container.innerHTML = '<p>No albums yet. Create one!</p>';
            showDeleteUserAction();
            return;
        }
        albums.forEach(a => container.appendChild(albumCard(userId, a)));
    } catch {
        container.textContent = 'Could not load albums.';
    }
}

function albumCard(userId, a) {
    const div = document.createElement('div');
    div.className = 'album-card';
    div.innerHTML = `<h3>${escapeHtml(a.name)}</h3><p>${a.count} photo(s)</p>`;
    div.addEventListener('click', (e) => {
        e.preventDefault();
        navigate(`#/user/${userId}/album/${a.id}`);
    });
    return div;
}

function renderCreateAlbum(userId) {
    view.innerHTML = '';
    setPrimary('Back to Albums', () => navigate(`#/user/${userId}`));

    const node = tplCreateAlbum.content.cloneNode(true);
    view.append(node);
    const form = document.getElementById('createAlbumForm');
    const status = document.getElementById('createAlbumStatus');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = new FormData(form).get('name');
        status.textContent = 'Creating...';
        try {
            await Albums.create(userId, name);
            status.textContent = 'Created!';
            navigate(`#/user/${userId}`);
        } catch (err) {
            status.textContent = 'Create failed: ' + (err?.message || '');
        }
    });
}

async function renderAlbum(userId, albumId) {
    view.innerHTML = '';

    const node = tplAlbum.content.cloneNode(true);
    view.append(node);

    const title = view.querySelector('#albumTitle');
    const form = view.querySelector('#uploadForm');
    const status = view.querySelector('#uploadStatus');
    const container = view.querySelector('.gallery');
    const albumSection = view.querySelector('.album');
    const fileInput = form.querySelector('#photosInput');

    form.classList.add('hidden');

    setPrimary('Add Pictures', () => {
        form.classList.remove('hidden');
        fileInput?.click();
    });

    try {
        const users = await Users.list();
        const u = users.find(x => x.id === userId);
        crumbs.textContent = u ? `Home > ${u.name} > Album` : 'Album';
    } catch {
        crumbs.textContent = 'Album';
    }

    try {
        const albums = await Albums.list(userId);
        const album = albums.find(a => a.id === albumId);
        if (album) title.textContent = `${album.name} (${album.count})`;
    } catch { /* ignore */ }

    let deleteWrap = null;

    // --- pagination state ---
    let allPhotos = [];
    let currentPage = 1;

    // bottom pager only
    const { bar: pagerBottom, prev: prevBottom, next: nextBottom, info: infoBottom } = makePager();

    function updatePager(total) {
        const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
        currentPage = Math.min(currentPage, totalPages);
        const label = `Page ${total ? currentPage : 0} of ${total ? totalPages : 0}`;
        infoBottom.textContent = label;

        const canPrev = currentPage > 1;
        const canNext = currentPage < totalPages;
        prevBottom.disabled = !canPrev;
        nextBottom.disabled = !canNext;
    }

    function renderPage() {
        container.innerHTML = '';
        if (deleteWrap && deleteWrap.parentNode) deleteWrap.remove();
        deleteWrap = null;

        const total = allPhotos.length;
        updatePager(total);

        if (!total) {
            container.textContent = 'This album is empty.';
            // Offer delete if empty
            (async () => {
                try {
                    const albums = await Albums.list(userId);
                    const album = Array.isArray(albums) ? albums.find(a => a.id === albumId) : null;
                    if (album) {
                        deleteWrap = document.createElement('div');
                        deleteWrap.className = 'album-actions';
                        const del = document.createElement('button');
                        del.className = 'danger';
                        del.textContent = 'Delete Album';
                        del.addEventListener('click', async () => {
                            if (!confirm(`Delete album "${album.name}"? This cannot be undone.`)) return;
                            try {
                                await Albums.del(userId, album.id);
                                navigate(`#/user/${userId}`);
                            } catch (err) {
                                alert('Delete failed: ' + (err?.message || ''));
                            }
                        });
                        deleteWrap.appendChild(del);
                        albumSection.prepend(deleteWrap);
                    }
                } catch (e) {
                    console.warn('Could not determine album deletability:', e);
                }
            })();
            return;
        }

        const start = (currentPage - 1) * PAGE_SIZE;
        const end = Math.min(start + PAGE_SIZE, total);
        const slice = allPhotos.slice(start, end);
        slice.forEach(p => container.appendChild(photoCard(userId, albumId, p, {
            onDelete: () => {
                // remove from master list and re-render page
                const idx = allPhotos.findIndex(x => x.id === p.id);
                if (idx >= 0) allPhotos.splice(idx, 1);
                // if page became empty and not first page, step back
                const totalAfter = allPhotos.length;
                const totalPagesAfter = Math.max(1, Math.ceil(totalAfter / PAGE_SIZE));
                if (currentPage > totalPagesAfter) currentPage = totalPagesAfter;
                renderPage();
                // keep title count in sync
                if (title && typeof title.textContent === 'string') {
                    const current = title.textContent;
                    const hasCount = /\(\d+\)$/.test(current);
                    const newCount = allPhotos.length;
                    title.textContent = hasCount
                        ? current.replace(/\(\d+\)$/, `(${newCount})`)
                        : `${current} (${newCount})`;
                }
            }
        })));
    }

    // hook up bottom pager buttons
    prevBottom.addEventListener('click', () => { if (currentPage > 1) { currentPage--; renderPage(); } });
    nextBottom.addEventListener('click', () => {
        const max = Math.max(1, Math.ceil(allPhotos.length / PAGE_SIZE));
        if (currentPage < max) { currentPage++; renderPage(); }
    });

    // mount bottom pager
    albumSection.appendChild(pagerBottom);

    async function loadPhotos() {
        try {
            const photos = await Albums.photos(userId, albumId);
            // update title count
            if (title && typeof title.textContent === 'string') {
                const current = title.textContent;
                const hasCount = /\(\d+\)$/.test(current);
                title.textContent = hasCount
                    ? current.replace(/\(\d+\)$/, `(${photos.length})`)
                    : `${current} (${photos.length})`;
            }
            allPhotos = Array.isArray(photos) ? photos : [];
            currentPage = 1;
            renderPage();
        } catch (err) {
            console.error('Failed to load photos:', err);
            container.textContent = 'Could not load photos.';
        }
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        status.textContent = 'Uploading...';
        const data = new FormData(form);
        try {
            await Albums.upload(userId, albumId, data);
            status.textContent = 'Uploaded!';
            form.reset();
            await loadPhotos();
        } catch (err) {
            status.textContent = 'Upload failed: ' + (err?.message || '');
        }
    });

    await loadPhotos();
}

function photoCard(userId, albumId, { id, url, caption }, { onDelete } = {}) {
    const div = document.createElement('div');
    div.className = 'card';

    const img = document.createElement('img');
    img.loading = 'lazy';
    const thumbUrl = thumbFrom(url);
    img.src = thumbUrl;

    const footer = document.createElement('footer');
    footer.textContent = caption || '';

    const actions = document.createElement('div');
    actions.className = 'actions';

    const del = document.createElement('button');
    del.className = 'danger';
    del.textContent = 'Delete';
    del.addEventListener('click', async (e) => {
        e.stopPropagation(); // don't trigger lightbox
        try {
            await Albums.deletePhoto(userId, albumId, id);
            onDelete?.();
        } catch (err) {
            alert('Delete failed: ' + (err?.message || ''));
        }
    });

    actions.appendChild(del);

    // open lightbox (transparent background, image floats)
    div.addEventListener('click', () => {
        const lb = ensureLightbox();
        lb.toggle(url, caption);
    });

    div.append(img, footer, actions);
    return div;
}

// --------- router entry ----------
function route() {
    const parts = parseHash();
    // #/users
    if (parts[0] === 'users' && !parts[1]) return renderUsers();
    // #/users/new
    if (parts[0] === 'users' && parts[1] === 'new') return renderCreateUser();
    // #/user/:userId
    if (parts[0] === 'user' && parts[1] && !parts[2]) return renderUserAlbums(parts[1]);
    // #/user/:userId/albums/new
    if (parts[0] === 'user' && parts[1] && parts[2] === 'albums' && parts[3] === 'new')
        return renderCreateAlbum(parts[1]);
    // #/user/:userId/album/:albumId
    if (parts[0] === 'user' && parts[1] && parts[2] === 'album' && parts[3])
        return renderAlbum(parts[1], parts[3]);

    // default
    renderUsers();
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// boot
route();
