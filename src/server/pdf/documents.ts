// PDFs: timesheets, invoices and fire roll call records. Figures come from the same functions
// as the screens and CSVs, so totals always match.
import PDFDocument from 'pdfkit';
import type { DB } from '../db';
import { addDays } from '../../shared/time';
import { fmtDate, fmtDateTime, fmtDay, fmtHours, fmtMoney, fmtTime } from '../../shared/format';
import { getTimesheetView } from '../services/timesheets';
import { agencyRow, invoiceStatus } from '../services/workflows';
import { uploadPath } from '../services/files';

type Doc = PDFKit.PDFDocument;

const INK = '#16181d';
const MUTED = '#5b6270';
const LINE = '#d9dce3';

function start(title: string): { doc: Doc; done: Promise<Buffer> } {
  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: { Title: title, Producer: 'SiteRoll' } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  return { doc, done };
}

function header(doc: Doc, db: DB, title: string, subtitle: string) {
  const a = agencyRow(db);
  doc.rect(0, 0, doc.page.width, 8).fill(a.brand_colour);
  let x = 48;
  const logo = uploadPath(a.logo_path);
  if (logo && /\.(png|jpe?g)$/i.test(logo)) {
    try {
      doc.image(logo, 48, 30, { fit: [110, 44] });
      x = 170;
    } catch {
      /* unreadable logo: carry on without it */
    }
  }
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text(a.name, x, 32, { width: 300 });
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(a.address, x, doc.y + 2, { width: 300 });
  if (a.phone || a.email) doc.text([a.phone, a.email].filter(Boolean).join('  ·  '), x, doc.y + 1, { width: 300 });
  doc.font('Helvetica-Bold').fontSize(20).fillColor(INK).text(title, 300, 30, { width: doc.page.width - 348, align: 'right' });
  doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text(subtitle, 300, doc.y + 2, { width: doc.page.width - 348, align: 'right' });
  doc.moveDown(0);
  doc.y = Math.max(doc.y, 96);
  doc.moveTo(48, doc.y).lineTo(doc.page.width - 48, doc.y).strokeColor(LINE).lineWidth(1).stroke();
  doc.y += 14;
  doc.x = 48;
}

function footer(doc: Doc, text: string) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(`${text}   ·   Page ${i + 1} of ${range.count}`, 48, doc.page.height - 30, { width: doc.page.width - 96, align: 'center' });
    doc.page.margins.bottom = bottom;
  }
}

interface Col {
  label: string;
  width: number;
  align?: 'left' | 'right' | 'center';
}

function table(doc: Doc, cols: Col[], rows: (string | { text: string; bold?: boolean; colour?: string })[][], opts: { fontSize?: number; zebra?: boolean } = {}) {
  const fs = opts.fontSize ?? 8.5;
  const left = 48;
  const drawHead = () => {
    let x = left;
    doc.font('Helvetica-Bold').fontSize(fs - 0.5).fillColor(MUTED);
    for (const c of cols) {
      doc.text(c.label.toUpperCase(), x + 3, doc.y, { width: c.width - 6, align: c.align ?? 'left', lineBreak: false });
      x += c.width;
    }
    doc.y += fs + 6;
    doc.moveTo(left, doc.y - 3).lineTo(left + cols.reduce((s, c) => s + c.width, 0), doc.y - 3).strokeColor(LINE).stroke();
  };
  drawHead();
  rows.forEach((row, ri) => {
    const rowH = fs + 8;
    if (doc.y + rowH > doc.page.height - 60) {
      doc.addPage();
      doc.y = 48;
      drawHead();
    }
    const y = doc.y;
    if (opts.zebra !== false && ri % 2 === 1) {
      doc.rect(left, y - 3, cols.reduce((s, c) => s + c.width, 0), rowH).fill('#f4f5f8');
    }
    let x = left;
    row.forEach((cell, ci) => {
      const c = cols[ci];
      const cv = typeof cell === 'string' ? { text: cell } : cell;
      doc.font(cv.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fs).fillColor(cv.colour ?? INK);
      doc.text(cv.text, x + 3, y, { width: c.width - 6, align: c.align ?? 'left', lineBreak: false, ellipsis: true });
      x += c.width;
    });
    doc.y = y + rowH;
  });
}

/* ---------------- Timesheet ---------------- */

export async function timesheetPdf(db: DB, siteId: number, weekStart: string, opts: { showRates: boolean }): Promise<Buffer> {
  const view = getTimesheetView(db, siteId, weekStart);
  const { doc, done } = start(`Timesheet ${view.site.name} ${weekStart}`);
  header(doc, db, 'Timesheet', `${view.site.clientName}\n${view.site.name}\nWeek ${fmtDay(weekStart)} – ${fmtDay(addDays(weekStart, 6))}`);

  const ts = view.timesheet;
  const status =
    ts.status === 'approved'
      ? `Approved by ${ts.approved_by_name} on ${fmtDateTime(ts.approved_at)}`
      : ts.status === 'queried'
        ? 'Queried by the client – not yet approved'
        : ts.status === 'sent'
          ? `Sent for approval ${fmtDateTime(ts.signoff_sent_at)} – not yet approved`
          : 'Not yet approved';
  doc.font('Helvetica-Bold').fontSize(10).fillColor(ts.status === 'approved' ? '#166534' : '#9a3412').text(status);
  doc.moveDown(0.6);

  const dayCols: Col[] = view.days.map((d) => ({ label: fmtDay(d).slice(0, 3), width: 40, align: 'center' as const }));
  const cols: Col[] = [{ label: 'Worker', width: 125 }, ...dayCols, { label: 'Basic', width: 38, align: 'right' }, { label: 'O/T', width: 34, align: 'right' }, { label: 'Total', width: 40, align: 'right' }];
  const rows = view.workers.map((w) => [
    { text: `${w.name}`, bold: true },
    ...view.days.map((d) => {
      const mins = w.shifts.filter((s) => s.date === d).reduce((s, x) => s + x.workedMins, 0);
      return mins ? fmtHours(mins) : '–';
    }),
    fmtHours(w.totals.normalMins),
    w.totals.otMins ? fmtHours(w.totals.otMins) : '–',
    { text: fmtHours(w.totals.totalMins), bold: true },
  ]);
  rows.push([
    { text: `${view.totals.workers} workers`, bold: true },
    ...view.days.map((d) => {
      const mins = view.workers.flatMap((w) => w.shifts).filter((s) => s.date === d).reduce((s, x) => s + x.workedMins, 0);
      return { text: mins ? fmtHours(mins) : '–', bold: true };
    }),
    { text: fmtHours(view.totals.normalMins), bold: true },
    { text: fmtHours(view.totals.otMins), bold: true },
    { text: fmtHours(view.totals.totalMins), bold: true },
  ]);
  table(doc, cols, rows);
  doc.moveDown(1);

  // Daily detail
  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text('Sign-in detail', 48);
  doc.moveDown(0.4);
  const detail: Col[] = [
    { label: 'Worker', width: 120 },
    { label: 'Day', width: 62 },
    { label: 'In', width: 42, align: 'center' },
    { label: 'Out', width: 48, align: 'center' },
    { label: 'Break', width: 42, align: 'right' },
    { label: 'Hours', width: 42, align: 'right' },
    { label: 'Notes', width: 143 },
  ];
  const drows = view.workers.flatMap((w) =>
    w.shifts.map((s) => [
      w.name,
      fmtDay(s.date),
      fmtTime(s.inAt),
      s.estimatedOut ? `${fmtTime(s.outAt)}*` : fmtTime(s.outAt),
      `${s.breakMins}m`,
      fmtHours(s.workedMins),
      { text: [s.flags.map(flagLabel).join(', '), s.queryComment ? `"${s.queryComment}"` : ''].filter(Boolean).join(' – '), colour: MUTED },
    ]),
  );
  table(doc, detail, drows, { fontSize: 8 });
  if (view.openShifts) {
    doc.moveDown(0.5).font('Helvetica').fontSize(8).fillColor(MUTED).text('* Still on site: counted to the usual finish time.', 48);
  }
  if (opts.showRates) {
    doc.moveDown(0.8);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(`Charge ${fmtMoney(view.totals.chargePence)}   ·   Pay ${fmtMoney(view.totals.payPence)}   ·   Margin ${fmtMoney(view.totals.chargePence - view.totals.payPence)}`, 48);
  }
  footer(doc, `SiteRoll timesheet · ${view.site.name} · w/c ${fmtDate(weekStart)}`);
  doc.end();
  return done;
}

function flagLabel(f: string) {
  return (
    {
      late: 'Late',
      not_booked: 'Not booked',
      card: 'Card issue',
      no_induction: 'No induction',
      missed_signout: 'Missed sign-out',
      manual: 'Manual',
      offline: 'Sent late (no signal)',
      edited: 'Edited',
      disputed: 'Queried',
      moved_site: 'Moved site',
      after_approval: 'After sign-off',
    }[f] ?? f
  );
}

/* ---------------- Invoice ---------------- */

export async function invoicePdf(db: DB, invoiceId: number): Promise<Buffer> {
  const inv = db.prepare('SELECT i.*, c.name AS client_name, c.address AS client_address FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.id = ?').get(invoiceId) as {
    number: string;
    client_name: string;
    client_address: string;
    week_start: string;
    issued_on: string;
    due_on: string;
    net_pence: number;
    vat_pence: number;
    gross_pence: number;
    status: string;
    paid_on: string | null;
  };
  const lines = db.prepare('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY id').all(invoiceId) as {
    site_name: string;
    description: string;
    minutes: number;
    rate_pence: number;
    amount_pence: number;
  }[];
  const a = agencyRow(db);
  const { doc, done } = start(`Invoice ${inv.number}`);
  header(doc, db, 'Invoice', `${inv.number}\nIssued ${fmtDate(inv.issued_on)}\nDue ${fmtDate(inv.due_on)}`);

  const top = doc.y;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text('BILL TO', 48, top);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(inv.client_name, 48, doc.y + 2, { width: 250 });
  doc.font('Helvetica').fontSize(9).fillColor(INK).text(inv.client_address, 48, doc.y + 1, { width: 250 });
  doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text('FOR', 320, top);
  doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(`Labour supplied, week commencing ${fmtDate(inv.week_start)} (to ${fmtDate(addDays(inv.week_start, 6))})`, 320, top + 13, { width: 227 });
  const st = invoiceStatus(inv);
  if (st !== 'sent') {
    doc.font('Helvetica-Bold').fontSize(14).fillColor(st === 'paid' ? '#166534' : '#b91c1c').text(st === 'paid' ? `PAID ${inv.paid_on ? fmtDate(inv.paid_on) : ''}` : 'OVERDUE', 320, doc.y + 6);
  }
  doc.y = Math.max(doc.y, top + 70);
  doc.x = 48;

  const cols: Col[] = [
    { label: 'Site', width: 120 },
    { label: 'Description', width: 200 },
    { label: 'Hours', width: 50, align: 'right' },
    { label: 'Rate', width: 64, align: 'right' },
    { label: 'Amount', width: 65, align: 'right' },
  ];
  table(
    doc,
    cols,
    lines.map((l) => [l.site_name, l.description, fmtHours(l.minutes), fmtMoney(l.rate_pence), fmtMoney(l.amount_pence)]),
  );
  doc.moveDown(0.8);
  const totals: [string, string, boolean][] = [
    ['Net', fmtMoney(inv.net_pence), false],
    ['VAT at 20%', fmtMoney(inv.vat_pence), false],
    ['Total due', fmtMoney(inv.gross_pence), true],
  ];
  for (const [label, value, bold] of totals) {
    const y = doc.y;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 12 : 10).fillColor(INK);
    doc.text(label, 320, y, { width: 110, align: 'right' });
    doc.text(value, 430, y, { width: 117, align: 'right' });
    doc.y = y + (bold ? 18 : 15);
  }
  doc.moveDown(1.5);
  doc.x = 48;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text('How to pay', 48);
  doc.font('Helvetica').fontSize(9.5).text(`Bank transfer to ${a.name}`, 48);
  doc.text(`${a.bank_name}  ·  Sort code ${a.bank_sort_code}  ·  Account ${a.bank_account}`, 48);
  doc.text(`Please quote ${inv.number}. Payment due within ${a.payment_terms_days} days, by ${fmtDate(inv.due_on)}.`, 48);
  doc.moveDown(0.8);
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(`Hours as approved by the client in SiteRoll. ${a.vat_number ? `VAT no. ${a.vat_number}. ` : ''}${a.company_number ? `Registered in England and Wales no. ${a.company_number}.` : ''}`, 48);
  footer(doc, `${a.name} · Invoice ${inv.number}`);
  doc.end();
  return done;
}

/* ---------------- Fire roll call ---------------- */

export async function rollCallPdf(db: DB, id: number): Promise<Buffer> {
  const rc = db.prepare('SELECT r.*, s.name AS site_name, s.address, s.postcode FROM roll_calls r JOIN sites s ON s.id = r.site_id WHERE r.id = ?').get(id) as {
    kind: string;
    site_name: string;
    address: string;
    postcode: string;
    started_by: string;
    started_at: string;
    finished_at: string | null;
    notes: string;
  };
  const people = db.prepare('SELECT * FROM roll_call_people WHERE roll_call_id = ? ORDER BY is_visitor, name').all(id) as {
    name: string;
    detail: string;
    is_visitor: number;
    safe_at: string | null;
    safe_by: string | null;
    help_at: string | null;
  }[];
  const safe = people.filter((p) => p.safe_at).length;
  const { doc, done } = start(`Roll call ${rc.site_name}`);
  header(doc, db, 'Fire roll call', `${rc.kind === 'incident' ? 'INCIDENT' : 'Drill'}\n${rc.site_name}\n${fmtDateTime(rc.started_at)}`);
  const allSafe = safe === people.length;
  doc.rect(48, doc.y, doc.page.width - 96, 46).fill(allSafe ? '#dcfce7' : '#fee2e2');
  doc.font('Helvetica-Bold').fontSize(18).fillColor(allSafe ? '#166534' : '#991b1b').text(`${safe} of ${people.length} accounted for`, 60, doc.y + 13);
  doc.y += 22;
  doc.x = 48;
  doc.font('Helvetica').fontSize(9.5).fillColor(INK);
  doc.text(`Site: ${rc.site_name}, ${rc.address}, ${rc.postcode}`, 48);
  doc.text(`Started by: ${rc.started_by} at ${fmtTime(rc.started_at)}`, 48);
  doc.text(`Finished: ${rc.finished_at ? fmtTime(rc.finished_at) : 'Not finished'}${rc.finished_at ? `  (${Math.round((new Date(rc.finished_at).getTime() - new Date(rc.started_at).getTime()) / 60000)} minutes)` : ''}`, 48);
  if (rc.notes) doc.text(`Notes: ${rc.notes}`, 48, doc.y, { width: doc.page.width - 96 });
  doc.moveDown(1);
  table(
    doc,
    [
      { label: 'Name', width: 190 },
      { label: 'Trade / details', width: 150 },
      { label: 'Visitor', width: 60 },
      { label: 'Safe at muster point', width: 99, align: 'right' },
    ],
    people.map((p) => [
      { text: p.name, bold: true },
      p.detail,
      p.is_visitor ? 'Yes' : '',
      p.safe_at
        ? { text: `${fmtTime(p.safe_at)}${p.safe_by === 'phone' ? ' (own phone)' : ''}`, colour: '#166534', bold: true }
        : p.help_at
          ? { text: `ASKED FOR HELP ${fmtTime(p.help_at)}`, colour: '#b91c1c', bold: true }
          : { text: 'NOT ACCOUNTED FOR', colour: '#b91c1c', bold: true },
    ]),
    { fontSize: 9.5 },
  );
  footer(doc, `SiteRoll fire roll call record · ${rc.site_name} · ${fmtDateTime(rc.started_at)}`);
  doc.end();
  return done;
}
