export function marginPctOf(chargePence: number, payPence: number): string {
  if (!chargePence) return '0';
  return (((chargePence - payPence) / chargePence) * 100).toFixed(1);
}

export function greeting(name: string | undefined): string {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  const first = (name ?? '').split(' ')[0];
  const part = h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening';
  return first ? `${part}, ${first}` : part;
}

export function timeSince(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m`;
}

export function download(href: string) {
  const a = document.createElement('a');
  a.href = href;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
