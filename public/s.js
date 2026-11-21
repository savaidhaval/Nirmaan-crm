// Token is read from the URL path: /s/<token>
    const token = location.pathname.split('/').pop();
    const btn = document.getElementById('btn-open');
    const msg = document.getElementById('msg');

    btn.addEventListener('click', () => {
      location.href = '/s/' + encodeURIComponent(token) + '/file';
    });
