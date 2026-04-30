// App entry point — init router, navbar, health polling
import { initRouter } from './router.js';
import { API } from './api.js';

function initNavbar() {
  const hamburger = document.getElementById('hamburger');
  const navLinks = document.getElementById('navLinks');
  if (hamburger) {
    hamburger.addEventListener('click', () => navLinks.classList.toggle('open'));
  }
  // Close nav on link click (mobile)
  navLinks.querySelectorAll('.nav-item').forEach(a => {
    a.addEventListener('click', () => navLinks.classList.remove('open'));
  });
}

// Health dot polling
let healthInterval = null;
function startHealthPolling() {
  const dot = document.getElementById('healthDot');
  const check = async () => {
    try {
      const h = await API.health();
      dot.className = 'health-dot ' + (h.status === 'ok' ? 'ok' : 'err');
    } catch {
      dot.className = 'health-dot err';
    }
  };
  check();
  healthInterval = setInterval(check, 30000);
}

// Load custom background image from localStorage
function loadBgImage() {
  const url = localStorage.getItem('asr_bg_image');
  if (url) {
    document.body.style.setProperty('--bg-image', `url("${url.replace(/"/g, '\\"')}")`);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadBgImage();
  initNavbar();
  startHealthPolling();
  initRouter();
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  if (healthInterval) clearInterval(healthInterval);
});
