document.getElementById('toggle-password').addEventListener('click', () => {
      const inp = document.getElementById('password');
      inp.type = inp.type === 'password' ? 'text' : 'password';
    });

    document.getElementById('btn-login').addEventListener('click', async () => {
      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value;
      const errorEl = document.getElementById('error');
      errorEl.style.display = 'none';

      if (!email || !password) {
        errorEl.textContent = 'Please enter both email and password.';
        errorEl.style.display = 'block';
        return;
      }

      try {
        await api('/api/auth/login', {
          method: 'POST',
          body: { email, password },
        });
        window.location.href = '/';
      } catch (err) {
        errorEl.textContent = err.message || 'Login failed. Try again.';
        errorEl.style.display = 'block';
      }
    });
