// Practice form: shows a confirmation instead of sending anything. A filled honeypot field is reported.
document.getElementById('f').addEventListener('submit', (e) => {
  e.preventDefault();
  const trap = document.getElementById('website').value;
  document.getElementById('f').style.display = 'none';
  const done = document.getElementById('done');
  done.style.display = 'block';
  document.getElementById('ref').textContent = String(Date.now()).slice(-6);
  if (trap) done.insertAdjacentHTML('beforeend', '<p><b>Warning:</b> the hidden trap field was filled in. A real site would reject this application.</p>');
});
