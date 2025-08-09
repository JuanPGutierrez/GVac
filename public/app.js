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
        // prevent duplicates if we re-render
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
                navigate('#/users'); // back to all users
            } catch (err) {
                alert('Delete failed: ' + (err?.message || ''));
            }
        });

        actions.appendChild(del);
        // place it near the empty-state message
        // (container exists even when empty, so this is a safe anchor)
        container.appendChild(actions);
    }

    try {
        const albums = await Albums.list(userId);
        if (!albums.length) {
            container.innerHTML = '<p>No albums yet. Create one!</p>';
            // ✅ show delete user if no albums exist
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

    // hide on load (template already hidden, but this is safe)
    form.classList.add('hidden');

    // top-right action: reveal form + open chooser
    setPrimary('Add Pictures', () => {
        form.classList.remove('hidden');
        fileInput?.click();
    });


    // crumbs
    try {
        const users = await Users.list();
        const u = users.find(x => x.id === userId);
        crumbs.textContent = u ? `Home > ${u.name} > Album` : 'Album';
    } catch {
        crumbs.textContent = 'Album';
    }

    // show album name/initial count
    try {
        const albums = await Albums.list(userId);
        const album = albums.find(a => a.id === albumId);
        if (album) title.textContent = `${album.name} (${album.count})`;
    } catch { /* ignore */ }

    // delete button appears only when empty
    let deleteWrap = null;

    async function loadPhotos() {
        container.innerHTML = '';
        if (deleteWrap && deleteWrap.parentNode) deleteWrap.remove();
        deleteWrap = null;

        try {
            const photos = await Albums.photos(userId, albumId);

            // keep count updated in title
            if (title && typeof title.textContent === 'string') {
                const current = title.textContent;
                const hasCount = /\(\d+\)$/.test(current);
                title.textContent = hasCount
                    ? current.replace(/\(\d+\)$/, `(${photos.length})`)
                    : `${current} (${photos.length})`;
            }

            if (!Array.isArray(photos) || photos.length === 0) {
                container.textContent = 'This album is empty.';

                // Offer delete if empty
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
                                navigate(`#/user/${userId}`); // back to that user's album list
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

            } else {
                photos.forEach(p => container.appendChild(photoCard(userId, albumId, p)));
            }
        } catch (err) {
            console.error('Failed to load photos:', err);
            container.textContent = 'Could not load photos.';
        }
    }

    // multi-file upload
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


function photoCard(userId, albumId, { id, url, caption }) {
    const div = document.createElement('div');
    div.className = 'card';
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = url;
    const footer = document.createElement('footer');
    footer.textContent = caption || '';
    const actions = document.createElement('div');
    actions.className = 'actions';
    const del = document.createElement('button');
    del.className = 'danger';
    del.textContent = 'Delete';
    del.addEventListener('click', async () => {
        try {
            await Albums.deletePhoto(userId, albumId, id);
            div.remove();
        } catch (err) {
            alert('Delete failed: ' + (err?.message || ''));
        }
    });
    actions.appendChild(del);

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
