const Auth = (() => {

  let mode = 'login'; // 'login' | 'register'

  function render() {
    const root = document.getElementById('auth-screen');
    root.innerHTML = `
      <div class="auth-card">
        <div class="auth-logo">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="white"><path d="M21.4 3.4 2.6 10.9c-.9.4-.9 1.7.1 2l4.4 1.4 1.7 5.4c.2.7 1.1.9 1.6.3l2.5-2.7 4.7 3.5c.7.5 1.7.1 1.9-.7l3.4-15.7c.2-1-.8-1.8-1.5-1.5Zm-3 3.2L9.8 13.9l-.4 3-1.4-4.4 10.8-6.7c.3-.2.6.2.2.4Z"/></svg>
        </div>
        <h1>Ягерь</h1>
        <p class="auth-sub">${mode === 'login' ? 'Войдите в свой аккаунт' : 'Создайте аккаунт'}</p>

        <form id="auth-form">
          <label>Имя пользователя</label>
          <input type="text" id="f-username" autocomplete="username" placeholder="например, ivan_petrov" required>

          <label>Пароль</label>
          <input type="password" id="f-password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" placeholder="минимум 4 символа" required>

          <div id="auth-error" class="auth-error" hidden></div>

          <button type="submit" class="auth-submit">${mode === 'login' ? 'Войти' : 'Зарегистрироваться'}</button>
        </form>

        <p class="auth-switch">
          ${mode === 'login' ? 'Нет аккаунта?' : 'Уже есть аккаунт?'}
          <a href="#" id="auth-switch-link">${mode === 'login' ? 'Зарегистрироваться' : 'Войти'}</a>
        </p>

        <p class="auth-note">Демо-режим: данные хранятся только в этом браузере, пока не подключён бэкенд.</p>
      </div>
    `;

    document.getElementById('auth-switch-link').addEventListener('click', (e) => {
      e.preventDefault();
      mode = mode === 'login' ? 'register' : 'login';
      render();
    });

    document.getElementById('auth-form').addEventListener('submit', handleSubmit);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const username = document.getElementById('f-username').value;
    const password = document.getElementById('f-password').value;
    const errorBox = document.getElementById('auth-error');
    const submitBtn = e.target.querySelector('.auth-submit');
    errorBox.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = mode === 'login' ? 'Входим…' : 'Создаём аккаунт…';

    try {
      const user = mode === 'login'
        ? await PoyetAPI.login(username, password)
        : await PoyetAPI.register(username, password);
      App.start(user);
    } catch (err) {
      errorBox.textContent = err.message || 'Что-то пошло не так';
      errorBox.hidden = false;
      submitBtn.disabled = false;
      submitBtn.textContent = mode === 'login' ? 'Войти' : 'Зарегистрироваться';
    }
  }

  function show() {
    document.getElementById('auth-screen').hidden = false;
    document.getElementById('app-screen').hidden = true;
    render();
  }

  function hide() {
    document.getElementById('auth-screen').hidden = true;
    document.getElementById('app-screen').hidden = false;
  }

  return { show, hide };
})();
