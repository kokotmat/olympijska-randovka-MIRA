(() => {
  const dialog = document.querySelector('#plan-dialog');
  if (!dialog || typeof dialog.showModal !== 'function') return;
  const image = document.querySelector('#plan-image');
  const viewport = document.querySelector('#plan-viewport');
  const less = document.querySelector('#plan-less');
  const more = document.querySelector('#plan-more');
  let scale = 1, opener;
  function zoom(value) {
    const previous = scale;
    scale = Math.max(.1, Math.min(4, value));
    const x = (viewport.scrollLeft + viewport.clientWidth / 2 - Math.max(0, viewport.clientWidth * (1 - previous) / 2)) / previous;
    const y = (viewport.scrollTop + viewport.clientHeight / 2) / previous;
    image.style.width = `${scale * 100}%`;
    image.style.marginInline = 'auto';
    viewport.scrollLeft = x * scale + Math.max(0, viewport.clientWidth * (1 - scale) / 2) - viewport.clientWidth / 2;
    viewport.scrollTop = y * scale - viewport.clientHeight / 2;
    document.querySelector('#plan-scale').textContent = `${Math.round(scale * 100)} %`;
    less.disabled = scale === .1; more.disabled = scale === 4;
  }
  document.querySelectorAll('[data-plan]').forEach(link => link.addEventListener('click', event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault(); opener = link;
    document.querySelector('#plan-title').textContent = link.dataset.plan === 'spolecny' ? 'Přízemí a ochoz · jeviště nahoře' : link.dataset.plan === 'prizemi' ? 'Velký sál · přízemí' : 'Ochoz · balkón';
    image.src = link.href;
    image.alt = link.querySelector('img').alt;
    document.querySelector('#plan-original').href = link.href;
    dialog.showModal(); zoom(1); viewport.scrollTo(0, 0);
  }));
  less.addEventListener('click', () => zoom(scale - .25));
  more.addEventListener('click', () => zoom(scale + .25));
  document.querySelector('#plan-reset').addEventListener('click', () => {
    const ratio = image.naturalWidth && image.naturalHeight ? image.naturalWidth / image.naturalHeight : 1600 / 2100;
    zoom(Math.min(1, viewport.clientHeight * ratio / viewport.clientWidth)); viewport.scrollTo(0, 0);
  });
  document.querySelector('#plan-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { image.removeAttribute('src'); opener?.focus({preventScroll:true}); });
})();
