const CONFIG = {
  API_BASE_URL: '',
  WS_URL: `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`,
};
window.CONFIG = CONFIG;
