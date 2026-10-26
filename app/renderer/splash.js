/* global CompanionI18n, splash */
// The splash plays the design's timeline by itself (splash.css). The main process sends the language
// for its statuses and, once both the timeline and the database are done, 'leave' to fade it out.
const tr = (key) => CompanionI18n.t(key);
const $ = (id) => document.getElementById(id);

splash.onInfo(({ language }) => {
  CompanionI18n.setLanguage(language);
  for (const [id, text] of [['s1', 'Initializing overlay'], ['s2', 'Loading item database'], ['s3', 'Ready']]) $(id).textContent = tr(text);
});
splash.onLeave(() => {
  const panel = $('panel');
  panel.classList.add('out');
  panel.addEventListener('animationend', (ev) => { if (ev.target === panel) splash.done(); });
  setTimeout(() => splash.done(), 900); // reduced motion: no animation to wait for
});
