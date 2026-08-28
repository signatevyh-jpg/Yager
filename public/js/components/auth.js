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
        <p class="auth-sub">${mode === 'login' ? 'Войдите по своему уникальному юзу' : 'Создайте новый аккаунт'}</p>

        <form id="auth-form">
          ${mode === 'register' ? `
            <label for="f-displayname">Имя пользователя <span class="auth-label-hint">(отображаемое)</span></label>
            <input type="text" id="f-displayname" placeholder="например, Иван Иванов" required maxlength="50" autocomplete="name">
            <div class="auth-field-tip">Имя отображается в чатах. Имена могут повторяться и меняться в любой момент.</div>
          ` : ''}

          <label for="f-username">Юз (username) <span class="auth-label-hint">${mode === 'register' ? '(уникальный)' : '(для входа)'}</span></label>
          <input type="text" id="f-username" autocomplete="username" placeholder="${mode === 'login' ? 'ваш @username или username' : 'например, ivan_petrov'}" required>
          ${mode === 'register' ? `
            <div class="auth-field-tip">Уникальный юз для поиска и авторизации. Существует только в одном экземпляре.</div>
          ` : ''}

          <label for="f-password">Пароль</label>
          <input type="password" id="f-password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" placeholder="минимум 4 символа" minlength="4" required>

          <div id="auth-error" class="auth-error" hidden></div>

          <button type="submit" class="auth-submit">${mode === 'login' ? 'Войти' : 'Зарегистрироваться'}</button>
        </form>

        <p class="auth-switch">
          ${mode === 'login' ? 'Нет аккаунта?' : 'Уже есть аккаунт?'}
          <a href="#" id="auth-switch-link">${mode === 'login' ? 'Зарегистрироваться' : 'Войти'}</a>
        </p>

        <p class="auth-note">Вход в мессенджер осуществляется по вашему уникальному <b>юзу</b>. Быстрый тест: юз <b>ivan_petrov</b> или <b>anna_smirnova</b>, пароль <b>password</b>.</p>
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
    const username = document.getElementById('f-username').value.trim();
    const password = document.getElementById('f-password').value;
    const displayNameInput = document.getElementById('f-displayname');
    const displayName = displayNameInput ? displayNameInput.value.trim() : '';
    const errorBox = document.getElementById('auth-error');
    const submitBtn = e.target.querySelector('.auth-submit');
    errorBox.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = mode === 'login' ? 'Входим…' : 'Создаём аккаунт…';

    try {
      const user = mode === 'login'
        ? await PoyetAPI.login(username, password)
        : await PoyetAPI.register(username, password, displayName);
      App.start(user);
    } catch (err) {
      errorBox.textContent = err.message || 'Что-то пошло не так';
      errorBox.hidden = false;
      submitBtn.disabled = false;
      submitBtn.textContent = mode === 'login' ? 'Войти' : 'Зарегистрироваться';
    }
  }

  function show() {
    const authScreen = document.getElementById('auth-screen');
    const appScreen = document.getElementById('app-screen');
    if (authScreen) {
      authScreen.hidden = false;
      authScreen.style.display = '';
    }
    if (appScreen) {
      appScreen.hidden = true;
      appScreen.style.display = 'none';
    }
    const modal = document.getElementById('new-chat-modal');
    if (modal) {
      modal.hidden = true;
      modal.style.display = 'none';
    }
    const groupModal = document.getElementById('new-group-modal');
    if (groupModal) {
      groupModal.hidden = true;
      groupModal.style.display = 'none';
    }
    const profileModal = document.getElementById('profile-modal');
    if (profileModal) {
      profileModal.hidden = true;
      profileModal.style.display = 'none';
    }
    const videoModal = document.getElementById('video-circle-modal');
    if (videoModal) {
      videoModal.hidden = true;
      videoModal.style.display = 'none';
    }
    render();
  }

  function hide() {
    const authScreen = document.getElementById('auth-screen');
    const appScreen = document.getElementById('app-screen');
    if (authScreen) {
      authScreen.hidden = true;
      authScreen.style.display = 'none';
    }
    if (appScreen) {
      appScreen.hidden = false;
      appScreen.style.display = '';
    }
  }

  return { show, hide };
})();
