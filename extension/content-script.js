const BUTTON_CLASS = 'gatheros-save-btn';
let button = null;

function createButton() {
  const btn = document.createElement('button');
  btn.className = BUTTON_CLASS;
  btn.textContent = 'Save to GatherOS';
  Object.assign(btn.style, {
    position: 'absolute',
    bottom: '8px',
    right: '8px',
    zIndex: '9999',
    padding: '6px 12px',
    background: '#1a1a1a',
    color: '#fff',
    border: '1px solid #444',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '12px',
    fontFamily: 'system-ui, sans-serif',
    opacity: '0.9',
    display: 'none',
  });
  btn.addEventListener('mouseenter', () => { btn.style.opacity = '1'; });
  btn.addEventListener('mouseleave', () => { btn.style.opacity = '0.9'; });
  return btn;
}

function findImageUrl(el) {
  const img = el.querySelector('img[srcset], img[src]');
  if (!img) return null;
  const srcset = img.getAttribute('srcset');
  if (srcset) {
    const candidates = srcset.split(',').map(s => s.trim().split(/\s+/)[0]).filter(Boolean);
    if (candidates.length > 0) return candidates[candidates.length - 1];
  }
  return img.getAttribute('src') || null;
}

function handleMouseEnter(e) {
  const target = e.target.closest('article, [role="article"]');
  if (!target || target.querySelector(`.${BUTTON_CLASS}`)) return;

  const url = findImageUrl(target);
  if (!url) return;

  button = createButton();
  target.style.position = 'relative';
  target.appendChild(button);
  button.style.display = 'block';

  button.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    button.textContent = 'Saving...';
    button.disabled = true;

    chrome.runtime.sendMessage(
      { type: 'drop-url', urls: [url] },
      (response) => {
        if (response?.ok) {
          button.textContent = '✓ Saved';
          setTimeout(() => { button.remove(); }, 2000);
        } else {
          button.textContent = response?.error || 'Failed';
          button.disabled = false;
          setTimeout(() => { button.textContent = 'Save to GatherOS'; }, 3000);
        }
      },
    );
  });
}

function handleMouseLeave(e) {
  const related = e.relatedTarget;
  const target = e.target.closest('article, [role="article"]');
  if (!target) return;
  if (related && target.contains(related)) return;
  const btn = target.querySelector(`.${BUTTON_CLASS}`);
  if (btn) btn.remove();
}

document.addEventListener('mouseover', handleMouseEnter, true);
document.addEventListener('mouseout', handleMouseLeave, true);
