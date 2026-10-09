// Built-in reward icons, shared by the dashboard and employee profiles.
// All drawn on a 24×24 grid with the same 1.75 stroke so they read as one set.
// Keys must match ICONS in routes/rewards.js.
(function () {
  const svg = body => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const calendar = '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>';

  const ICONS = {
    'day-off': { label: 'Day off', svg: svg(`${calendar}<path d="M9 15.2l2 2 4-4.2"/>`) },
    'weekend': { label: 'Weekend', svg: svg(`${calendar}<path d="M12.5 13.5h4.5v4h-4.5z" fill="currentColor" stroke="none"/><path d="M7 13.5h3M7 17h3"/>`) },
    'long-weekend': { label: 'Long weekend', svg: svg('<path d="M4 13a8 8 0 0 1 16 0z"/><path d="M12 5v-1.5M12 13l2.6 7.5"/><path d="M3 21h18"/>') },
    'shirt': { label: 'Clothing', svg: svg('<path d="M8.5 3.5L3.5 6.5l2 4.5 2.5-1v10.5h8V10l2.5 1 2-4.5-5-3a3.5 3.5 0 0 1-7 0z"/>') },
    'meat': { label: 'Meat', svg: svg('<path d="M15 3.8c3.6 0 6 2.7 6 6.4 0 5.3-5.2 10-11.2 10-4 0-6.8-2.4-6.8-5.4 0-2.6 2-3.7 3.7-4.8C9.3 8.3 9.8 3.8 15 3.8z"/><circle cx="15" cy="9.5" r="2"/>') },
    'gift': { label: 'Gift', svg: svg('<rect x="3.5" y="8" width="17" height="4" rx="1"/><path d="M5.5 12v7.5a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V12M12 8v12.5"/><path d="M12 8C10.5 4.5 6.5 4.2 6.5 6.3 6.5 8 10 8 12 8zM12 8c1.5-3.5 5.5-3.8 5.5-1.7C17.5 8 14 8 12 8z"/>') },
    'star': { label: 'Star', svg: svg('<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/>') }
  };

  // A sensible icon from the reward's name, used until one is picked
  function guess(name) {
    const n = String(name || '').toLowerCase();
    if (n.includes('long weekend')) return 'long-weekend';
    if (n.includes('weekend')) return 'weekend';
    if (n.includes('day off') || n.includes('time off')) return 'day-off';
    if (/flannel|shirt|hoodie|hat|jacket|apparel|clothing/.test(n)) return 'shirt';
    if (/meat|steak|beef|pork|sausage|bbq/.test(n)) return 'meat';
    return 'gift';
  }

  // The reward's picture as HTML: its photo if one was uploaded, otherwise its icon
  function picture(reward, className) {
    const cls = className || 'reward-pic';
    if (reward.has_image) {
      return `<img class="${cls} photo" src="/reward-image/${reward.id}?v=${reward.image_version || 0}" alt="" loading="lazy">`;
    }
    const key = ICONS[reward.icon] ? reward.icon : guess(reward.reward);
    return `<span class="${cls} icon">${ICONS[key].svg}</span>`;
  }

  window.RewardIcons = { ICONS, guess, picture };
})();
