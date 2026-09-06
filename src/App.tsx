import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';

type View = 'overview' | 'members' | 'contributions' | 'sepa' | 'spg' | 'settings';
type MemberInput = {
  memberNumber?: string; salutation?: string; title?: string; firstName: string; lastName: string;
  gender?: string; birthDate?: string; street?: string; postalCode?: string; city?: string; country?: string;
  phonePrivate?: string; phoneMobile?: string; phoneBusiness?: string; email?: string; website?: string;
  entryDate: string; exitDate?: string; exitReason?: string; department?: string; departmentEntryDate?: string;
  contributionType?: string; annualFeeCents: number; paymentFrequency?: string; paymentMethod?: string;
  accountHolder?: string; iban?: string; bic?: string; mandateReference?: string; mandateSignedAt?: string;
  sepaSequence?: string; functionName?: string; honors?: string; alternateAddress?: string; customFields?: string | Record<string, string>;
  notes?: string; privacyConsentAt?: string; imageConsent?: boolean; emailConsent?: boolean;
};
type Member = MemberInput & { id: string; memberNumber: string; spgSyncedAt?: string | null };
type BridgeStatus = { connected: boolean; compatible: boolean; writeCompatible?: boolean; sqlServerMajor?: number; databaseVersion?: number; expectedSqlServerMajor?: number; expectedDatabaseVersion?: number; mandant?: string; reason?: string | null };
type Settings = Record<string, string>;
type MemberStatus = 'Aktiv' | 'Ausgetreten' | 'Prüfen';

const contributionTypes = [
  { code: '01', name: 'Erwachsene aktive Mitglieder', amount: 8000 },
  { code: '02', name: 'Inaktive/fördernde Mitglieder', amount: 1500 },
  { code: '03', name: 'Jugendliche bis 17 Jahren', amount: 6000 },
  { code: '04', name: 'Familienmitgliedschaft', amount: 4000 },
];
const viewTitles: Record<View, string> = {
  overview: 'Übersicht', members: 'Mitglieder', contributions: 'Beiträge',
  sepa: 'SEPA-Läufe', spg: 'SPG-Sicherung', settings: 'Einstellungen',
};
const pageSize = 25;

export default function App() {
  const [view, setView] = useState<View>('members');
  const [members, setMembers] = useState<Member[]>([]);
  const [settings, setSettings] = useState<Settings>({});
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    try {
      const response = await fetch('/api/members');
      const data = (await response.json()) as { members?: Member[]; error?: string };
      if (!response.ok) throw new Error(data.error || 'Bestand konnte nicht geladen werden.');
      setMembers(data.members || []);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Bestand konnte nicht geladen werden.'); }
    finally { setLoading(false); }
  }, []);
  const reloadSettings = useCallback(async () => {
    try {
      const response = await fetch('/api/settings');
      const data = (await response.json()) as { settings?: Settings };
      setSettings(data.settings || {});
    } catch { /* Einstellungen sind für den Bestand nicht zwingend */ }
  }, []);
  useEffect(() => { void reload(); void reloadSettings(); }, [reload, reloadSettings]);
  async function saveMember(input: MemberInput, id?: string) {
    const response = await fetch(id ? `/api/members/${id}` : '/api/members', { method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    const data = (await response.json()) as { member?: Member; error?: string };
    if (!response.ok || !data.member) throw new Error(data.error || 'Das Mitglied konnte nicht gespeichert werden.');
    setMembers((current) => id ? current.map((member) => member.id === id ? data.member! : member) : [...current, data.member!]);
    setNotice(`${input.firstName} ${input.lastName} wurde gespeichert.`); setError(''); setView('members');
    return data.member;
  }
  function search(value: string) { setQuery(value); if (value && view !== 'members') setView('members'); }
  return <div className="grid min-h-screen bg-[var(--canvas)] text-[var(--ink)] lg:grid-cols-[246px_minmax(0,1fr)]">
    <Sidebar view={view} setView={setView} members={members} clubName={settings.clubName} />
    <main className="flex min-w-0 flex-col">
      <Topbar view={view} query={query} onQuery={search} onNew={() => setView('members')} />
      <div className="w-full max-w-[1320px] px-5 pb-14 pt-6 md:px-7">
        <MobileNav view={view} setView={setView} />
        {(notice || error) && <Notice error={error}>{error || notice}</Notice>}
        {view === 'overview' && <Overview members={members} setView={setView} />}
        {view === 'members' && <MembersView members={members} loading={loading} query={query} onSave={saveMember} />}
        {view === 'contributions' && <ContributionsView members={members} />}
        {view === 'sepa' && <SepaView members={members} settings={settings} />}
        {view === 'spg' && <SpgView members={members} onImported={reload} />}
        {view === 'settings' && <SettingsView settings={settings} onSaved={reloadSettings} />}
      </div>
    </main>
  </div>;
}

function Sidebar({ view, setView, members, clubName }: { view: View; setView: (view: View) => void; members: Member[]; clubName?: string }) {
  const active = members.filter((member) => !member.exitDate);
  const withMandate = active.filter(usesSepa).length;
  const share = active.length ? Math.round((withMandate / active.length) * 100) : 0;
  const items: Array<[View, string]> = [
    ['overview', ''], ['members', String(members.length)], ['contributions', ''],
    ['sepa', String(active.filter(usesSepa).length)], ['spg', String(members.filter((member) => !member.spgSyncedAt).length)], ['settings', ''],
  ];
  return <aside className="sticky top-0 hidden h-screen flex-col bg-[var(--shell)] px-3.5 pb-3.5 pt-[18px] text-[var(--shell-fg)] lg:flex">
    <div className="flex items-center gap-[11px] px-2 pb-[18px] pt-1">
      <span className="grid size-[34px] flex-none place-items-center rounded-[10px] bg-[var(--red)] text-[11px] font-bold tracking-[0.04em] text-white shadow-[0_4px_12px_rgba(200,16,46,.35)]">SVG</span>
      <div className="min-w-0">
        <p className="truncate text-[13.5px] font-semibold -tracking-[0.01em]">{clubName || 'Vereinsverwaltung'}</p>
        <p className="mt-px text-[11px] text-[var(--shell-faint)]">Mitgliederverwaltung</p>
      </div>
    </div>
    <nav className="flex flex-col gap-0.5" aria-label="Hauptnavigation">
      {items.map(([key, badge]) => {
        const on = view === key;
        return <button key={key} onClick={() => setView(key)} aria-current={on ? 'page' : undefined}
          className={`flex w-full items-center gap-2.5 rounded-[10px] px-[11px] py-[9px] text-left text-[13.5px] transition ${on ? 'bg-[var(--shell-fg)] font-semibold text-[var(--shell)]' : 'font-medium text-[var(--shell-nav)] hover:bg-white/10 hover:text-white'}`}>
          <span className={`size-1.5 flex-none rounded-[2px] ${on ? 'bg-[var(--red)]' : 'bg-white/30'}`} />
          <span className="min-w-0 flex-1 truncate">{viewTitles[key]}</span>
          {badge && <span className={`font-mono text-[10.5px] ${on ? 'text-[var(--muted-ink)]' : 'text-[var(--shell-badge)]'}`}>{badge}</span>}
        </button>;
      })}
    </nav>
    <div className="mt-[22px] rounded-xl bg-white/7 px-3.5 py-[13px]">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--shell-muted)]">SEPA-Abdeckung</p>
        <span className="font-mono text-[11px] text-[var(--shell-fg)]">{share} %</span>
      </div>
      <div className="mt-[9px] h-[5px] overflow-hidden rounded-full bg-white/15">
        <div className="h-[5px] rounded-full bg-[var(--red)] transition-[width] duration-500" style={{ width: `${share}%` }} />
      </div>
      <p className="mt-[9px] text-[11.5px] leading-[1.4] text-[var(--shell-muted)]">{withMandate} von {active.length} aktiven Mitgliedern mit Mandat</p>
    </div>
    <div className="mt-auto flex items-center gap-2.5 border-t border-white/12 pt-3.5">
      <span className="grid size-8 flex-none place-items-center rounded-full bg-[var(--red)] text-[11px] font-semibold text-white">GV</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-medium">Vereinsverwaltung</p>
        <p className="mt-px truncate text-[11px] text-[var(--shell-faint)]">Lokal angemeldet</p>
      </div>
      <span className="size-[7px] flex-none rounded-full bg-[var(--ok-dot)]" />
    </div>
  </aside>;
}

function Topbar({ view, query, onQuery, onNew }: { view: View; query: string; onQuery: (value: string) => void; onNew: () => void }) {
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); field.current?.focus(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return <div className="sticky top-0 z-30 flex flex-wrap items-center gap-3.5 border-b border-[var(--line)] bg-[var(--canvas)]/90 px-5 py-3 backdrop-blur-[10px] md:px-7">
    <p className="text-[12.5px] text-[var(--muted-ink)]">Verein <span className="text-[var(--shell-muted)]">/</span> <span className="font-medium text-[var(--ink)]">{viewTitles[view]}</span></p>
    <div className="flex h-[34px] min-w-[170px] max-w-[420px] flex-1 items-center gap-2 rounded-[10px] bg-white px-2.5 shadow-[0_1px_2px_rgba(23,21,15,.07),var(--shadow-hair)]">
      <span className="text-[12px] text-[var(--faint-ink)]">Suchen</span>
      <input ref={field} value={query} onChange={(event) => onQuery(event.target.value)} aria-label="Mitglieder suchen"
        placeholder="Mitglied, Nummer, IBAN …" className="h-8 min-w-0 flex-1 border-0 bg-transparent text-[13px] outline-none" />
      <span className="rounded-[5px] bg-[var(--canvas)] px-[5px] py-0.5 font-mono text-[10px] text-[var(--muted-ink)]">⌘K</span>
    </div>
    <MemberDialog onNew={onNew} trigger={<button className="h-[34px] rounded-[9px] bg-[var(--red)] px-3.5 text-[13px] font-semibold text-white shadow-[var(--shadow-red)] transition hover:bg-[var(--red-dark)] active:translate-y-px">Neues Mitglied</button>} />
  </div>;
}

function MobileNav({ view, setView }: { view: View; setView: (view: View) => void }) {
  return <div className="mb-5 flex gap-1.5 overflow-x-auto rounded-[10px] bg-white p-[3px] shadow-[0_1px_2px_rgba(23,21,15,.06),var(--shadow-hair)] lg:hidden">
    {(Object.keys(viewTitles) as View[]).map((key) => <button key={key} onClick={() => setView(key)}
      className={`h-7 whitespace-nowrap rounded-lg px-3 text-[12.5px] transition ${view === key ? 'bg-[var(--shell)] font-semibold text-white shadow-[0_2px_6px_rgba(23,21,15,.22)]' : 'font-medium text-[var(--muted-ink)]'}`}>{viewTitles[key]}</button>)}
  </div>;
}

function Overview({ members, setView }: { members: Member[]; setView: (view: View) => void }) {
  const active = members.filter((member) => !member.exitDate);
  const pending = members.filter((member) => !member.spgSyncedAt).length;
  const mandates = active.filter(usesSepa);
  const target = active.reduce((sum, member) => sum + member.annualFeeCents, 0);
  const history = yearHistory(members);
  const counts = history.map((point) => point.count);
  const missingMandateDate = active.filter((member) => member.paymentMethod === 's' && !member.mandateSignedAt).length;
  const leaving = members.filter((member) => member.exitDate && new Date(member.exitDate) >= new Date()).length;
  const tasks = [
    pending > 0 && { tag: pad(pending), chipBg: 'var(--red-soft)', chipFg: 'var(--red)', title: `${pending} Datensätze warten auf SPG`, detail: 'Rückschreiben bleibt bis zum bestandenen Roundtrip-Test gesperrt.', action: 'Prüfen', go: () => setView('spg') },
    missingMandateDate > 0 && { tag: pad(missingMandateDate), chipBg: 'var(--warn-bg)', chipFg: 'var(--warn-fg)', title: `${missingMandateDate} Mandate ohne Unterschriftsdatum`, detail: 'Ohne Datum bricht der Lastschriftlauf ab.', action: 'Öffnen', go: () => setView('members') },
    leaving > 0 && { tag: pad(leaving), chipBg: 'var(--info-bg)', chipFg: 'var(--info-fg)', title: `${leaving} Austritte vorgemerkt`, detail: 'Das Beitragssoll sinkt dadurch im Folgejahr.', action: 'Ansehen', go: () => setView('members') },
  ].filter(Boolean) as Array<{ tag: string; chipBg: string; chipFg: string; title: string; detail: string; action: string; go: () => void }>;
  const moments = upcomingMoments(members);
  const kpis = [
    { label: 'Mitglieder', value: String(members.length), delta: `${active.length} aktiv`, ok: true, spark: spark(counts, 'var(--shell)') },
    { label: 'SEPA-Mandate', value: String(mandates.length), delta: active.length - mandates.length ? `${active.length - mandates.length} ohne` : 'vollständig', ok: mandates.length === active.length, spark: spark(counts, 'var(--shell)') },
    { label: 'Jahressoll', value: amount(target), delta: 'EUR aktiv', ok: true, spark: spark(history.map((point) => point.target || 1), 'var(--shell)') },
    { label: 'SPG offen', value: String(pending), delta: pending ? 'Handlung nötig' : 'alles übertragen', ok: pending === 0, spark: spark(counts, 'var(--red)') },
  ];
  return <div className="animate-fade-up">
    <div className="flex flex-wrap items-end justify-between gap-5">
      <div>
        <p className="text-[11.5px] uppercase tracking-[0.14em] text-[var(--muted-ink)]">{today()}</p>
        <h1 className="mt-2 text-[30px] font-semibold -tracking-[0.03em]">Vereinsbestand</h1>
        <p className="mt-1.5 text-[14px] text-[var(--muted-ink)]">{tasks.length ? `${tasks.length} Vorgänge warten auf deine Freigabe.` : 'Keine offenen Vorgänge — der Bestand läuft rund.'}</p>
      </div>
      <button onClick={() => setView('sepa')} className="h-9 rounded-[9px] bg-[var(--shell)] px-3.5 text-[13px] font-medium text-white shadow-[var(--shadow-ink)] transition hover:bg-[var(--shell-hover)]">SEPA-Lauf starten</button>
    </div>

    <div className="mt-[22px] grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-3.5">
      {kpis.map((kpi) => <div key={kpi.label} className="animate-fade-up rounded-[14px] bg-white px-4 pb-3.5 pt-[15px] shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between gap-2.5">
          <p className="text-[11.5px] font-medium text-[var(--muted-ink)]">{kpi.label}</p>
          <span className="whitespace-nowrap rounded-full px-[7px] py-[3px] text-[10.5px] font-semibold" style={{ background: kpi.ok ? 'var(--ok-bg)' : 'var(--red-soft)', color: kpi.ok ? 'var(--ok-fg)' : 'var(--red-dark)' }}>{kpi.delta}</span>
        </div>
        <p className="mt-[11px] whitespace-nowrap text-[29px] font-semibold leading-none -tracking-[0.03em] tabular-nums">{kpi.value}</p>
        <div className="mt-3 flex h-7 items-end gap-[3px]">
          {kpi.spark.map((bar, index) => <div key={index} className="animate-grow flex-1 rounded-[2px]" style={{ height: bar.h, background: bar.fill }} />)}
        </div>
      </div>)}
    </div>

    <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-4">
      <section className="rounded-[14px] bg-white p-[18px] pb-3.5 shadow-[var(--shadow-card)]">
        <div className="flex items-baseline justify-between gap-2.5">
          <h2 className="text-[14.5px] font-semibold -tracking-[0.01em]">Mitgliederentwicklung</h2>
          <span className="font-mono text-[11px] text-[var(--muted-ink)]">{history[0]?.year} – {history[history.length - 1]?.year}</span>
        </div>
        <div className="mt-4 grid h-[132px] grid-cols-8 items-end gap-2">
          {history.map((point, index) => <div key={point.year} className="flex h-full flex-col justify-end gap-1.5">
            <span className="text-center font-mono text-[10.5px] text-[var(--muted-ink)]">{point.count}</span>
            <div className="animate-grow rounded-[5px_5px_2px_2px]" style={{ height: barHeight(point.count, counts), background: index === history.length - 1 ? 'var(--red)' : 'var(--line-bar)', animationDelay: `${index * 45}ms` }} />
          </div>)}
        </div>
        <div className="mt-2.5 grid grid-cols-8 gap-2 border-t border-[var(--line-soft)] pt-2">
          {history.map((point) => <span key={point.year} className="text-center font-mono text-[10px] text-[var(--muted-ink)]">{point.year}</span>)}
        </div>
      </section>

      <section className="rounded-[14px] bg-white p-[18px] shadow-[var(--shadow-card)]">
        <div className="flex items-baseline justify-between gap-2.5">
          <h2 className="text-[14.5px] font-semibold -tracking-[0.01em]">Offene Vorgänge</h2>
          <span className="text-[11px] text-[var(--muted-ink)]">{tasks.length} offen</span>
        </div>
        <div className="mt-3.5 flex flex-col gap-[9px]">
          {tasks.length ? tasks.map((task) => <div key={task.title} className="flex items-start gap-[11px] rounded-[11px] bg-[var(--surface)] px-3 py-[11px] shadow-[0_0_0_1px_var(--line-soft)]">
            <span className="grid size-6 flex-none place-items-center rounded-[7px] font-mono text-[10px] font-semibold" style={{ background: task.chipBg, color: task.chipFg }}>{task.tag}</span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium">{task.title}</p>
              <p className="mt-0.5 text-pretty text-[12px] text-[var(--muted-ink)]">{task.detail}</p>
            </div>
            <button onClick={task.go} className="whitespace-nowrap rounded-[7px] bg-white px-[9px] py-[5px] text-[11.5px] font-medium shadow-[var(--shadow-hair)] transition hover:bg-[var(--shell)] hover:text-white">{task.action}</button>
          </div>) : <p className="rounded-[11px] bg-[var(--surface)] px-3 py-4 text-[12.5px] text-[var(--muted-ink)] shadow-[0_0_0_1px_var(--line-soft)]">Nichts zu tun — alle Mandate, Austritte und SPG-Übertragungen sind aktuell.</p>}
        </div>
      </section>
    </div>

    {moments.length > 0 && <section className="mt-4 rounded-[14px] bg-white p-[18px] shadow-[var(--shadow-card)]">
      <div className="flex items-baseline justify-between gap-2.5">
        <h2 className="text-[14.5px] font-semibold -tracking-[0.01em]">Diesen Monat im Verein</h2>
        <span className="font-mono text-[11px] text-[var(--muted-ink)]">{monthLabel()}</span>
      </div>
      <div className="mt-3.5 grid grid-cols-[repeat(auto-fit,minmax(215px,1fr))] gap-3">
        {moments.map((moment) => <div key={moment.key} className="rounded-xl px-[15px] py-3.5" style={{ background: moment.highlight ? 'var(--red-soft)' : 'var(--surface)', boxShadow: `0 0 0 1px ${moment.highlight ? 'var(--red-ring)' : 'var(--line-warm)'}` }}>
          <div className="flex items-center gap-[9px]">
            <span className="grid size-[26px] place-items-center rounded-full font-mono text-[10.5px] font-semibold" style={{ background: moment.highlight ? 'var(--red)' : '#fff', color: moment.highlight ? '#fff' : 'var(--red)' }}>{moment.tag}</span>
            <p className="text-[11px] uppercase tracking-[0.1em] text-[var(--muted-ink)]">{moment.kind}</p>
          </div>
          <p className="mt-[11px] text-[15.5px] font-semibold -tracking-[0.015em]">{moment.name}</p>
          <p className="mt-0.5 text-pretty text-[12.5px] text-[var(--muted-ink)]">{moment.detail}</p>
          <p className="mt-[11px] font-mono text-[11px] text-[var(--muted-ink)]">{moment.date}</p>
        </div>)}
      </div>
    </section>}
  </div>;
}

function MembersView({ members, loading, query, onSave }: { members: Member[]; loading: boolean; query: string; onSave: (input: MemberInput, id?: string) => Promise<Member> }) {
  const [filter, setFilter] = useState<'Alle' | 'Aktiv' | 'SEPA'>('Alle');
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => members.filter((member) => {
    const hit = `${member.firstName} ${member.lastName} ${member.memberNumber} ${member.email || ''} ${member.iban || ''}`.toLowerCase().includes(query.toLowerCase());
    const match = filter === 'Alle' || (filter === 'Aktiv' && !member.exitDate) || (filter === 'SEPA' && usesSepa(member));
    return hit && match;
  }), [members, query, filter]);
  useEffect(() => { setPage(1); }, [query, filter]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pages);
  const visible = filtered.slice((current - 1) * pageSize, current * pageSize);
  const withMandate = members.filter(usesSepa).length;
  const pending = members.filter((member) => !member.spgSyncedAt).length;
  return <div className="animate-fade-up">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[24px] font-semibold -tracking-[0.025em]">Mitglieder</h1>
        <p className="mt-[5px] text-[13.5px] text-[var(--muted-ink)]">{members.length} Datensätze · {withMandate} mit SEPA-Mandat · {pending} warten auf SPG</p>
      </div>
      <div className="flex gap-1.5 rounded-[10px] bg-white p-[3px] shadow-[0_1px_2px_rgba(23,21,15,.06),var(--shadow-hair)]">
        {(['Alle', 'Aktiv', 'SEPA'] as const).map((chip) => <button key={chip} onClick={() => setFilter(chip)}
          className={`h-7 rounded-lg px-3 text-[12.5px] transition ${filter === chip ? 'bg-[var(--shell)] font-semibold text-white shadow-[0_2px_6px_rgba(23,21,15,.22)]' : 'font-medium text-[var(--muted-ink)]'}`}>{chip}</button>)}
      </div>
    </div>

    <div className="mt-[18px] overflow-hidden rounded-[14px] bg-white shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line-soft)] px-4 py-3">
        <p className="text-[12.5px] text-[var(--muted-ink)]">{filtered.length} von {members.length} Mitgliedern{query && ' · gefiltert'}</p>
        <button onClick={() => exportCsv(filtered)} disabled={!filtered.length}
          className="h-[30px] rounded-lg bg-[var(--surface)] px-[11px] text-[12px] shadow-[var(--shadow-hair)] transition hover:bg-[var(--line-softer)] disabled:opacity-50">CSV</button>
      </div>
      {!loading && !filtered.length ? <div className="px-6 py-20 text-center">
        <h2 className="text-xl font-semibold">{members.length ? 'Keine Treffer' : 'Noch keine Mitglieder angelegt'}</h2>
        <p className="mx-auto mt-2 max-w-md text-pretty text-[13.5px] text-[var(--muted-ink)]">{members.length ? 'Passe Suche oder Filter an.' : 'Lege den ersten Datensatz an oder lies den SPG-Bestand über die Windows-Brücke ein.'}</p>
      </div> : <>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] table-fixed border-collapse">
            <thead><tr className="bg-[var(--surface)]">
              <th className="px-3.5 py-[9px] text-left text-[11px] font-semibold tracking-[0.04em] text-[var(--muted-ink)]">Mitglied</th>
              <th className="w-[86px] px-2 py-[9px] text-left text-[11px] font-semibold tracking-[0.04em] text-[var(--muted-ink)]">Abteilung</th>
              <th className="w-[78px] px-2 py-[9px] text-left text-[11px] font-semibold tracking-[0.04em] text-[var(--muted-ink)]">Eintritt</th>
              <th className="w-[86px] px-2 py-[9px] text-right text-[11px] font-semibold tracking-[0.04em] text-[var(--muted-ink)]">Beitrag</th>
              <th className="w-[104px] py-[9px] pl-2 pr-3.5 text-left text-[11px] font-semibold tracking-[0.04em] text-[var(--muted-ink)]">Status</th>
            </tr></thead>
            <tbody>{visible.map((member) => {
              const state = memberStatus(member);
              const tone = statusTone(state);
              return <tr key={member.id} className="border-t border-[var(--line-softer)] transition-colors hover:bg-[var(--surface)]">
                <td className="overflow-hidden px-3.5 py-[9px]">
                  <MemberDialog member={member} onSave={onSave} trigger={<button className="flex w-full min-w-0 items-center gap-2.5 text-left">
                    <span className="grid size-[30px] flex-none place-items-center rounded-full text-[11px] font-semibold" style={{ background: state === 'Prüfen' ? 'var(--red-soft)' : 'var(--line-dim)', color: state === 'Prüfen' ? 'var(--red)' : 'var(--ink-2)' }}>{initials(member)}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px] font-medium">{member.firstName} {member.lastName}</span>
                      <span className="mt-px block truncate font-mono text-[11.5px] text-[var(--muted-ink)]">{member.memberNumber}</span>
                    </span>
                  </button>} />
                </td>
                <td className="truncate px-2 py-[9px] text-[13px] text-[var(--ink-2)]">{member.department || '–'}</td>
                <td className="whitespace-nowrap px-2 py-[9px] text-[12.5px] tabular-nums text-[var(--ink-2)]">{dateDe(member.entryDate)}</td>
                <td className="whitespace-nowrap px-2 py-[9px] text-right text-[13px] font-medium tabular-nums">{euro(member.annualFeeCents)}</td>
                <td className="py-[9px] pl-2 pr-3.5">
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-[9px] py-1 text-[11.5px] font-medium" style={{ background: tone.bg, color: tone.fg }}>
                    <span className="size-[5px] rounded-full" style={{ background: tone.fg }} />{state}
                  </span>
                </td>
              </tr>;
            })}</tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line-soft)] bg-[var(--surface)] px-4 py-[11px]">
          <p className="text-[12px] text-[var(--muted-ink)]">Seite {current} von {pages}</p>
          <div className="flex gap-1.5">
            <button onClick={() => setPage(current - 1)} disabled={current <= 1} className="h-7 rounded-[7px] bg-white px-2.5 text-[12px] shadow-[var(--shadow-hair)] transition enabled:hover:bg-[var(--shell)] enabled:hover:text-white disabled:text-[var(--faint-ink)]">Zurück</button>
            <button onClick={() => setPage(current + 1)} disabled={current >= pages} className="h-7 rounded-[7px] bg-white px-2.5 text-[12px] shadow-[var(--shadow-hair)] transition enabled:hover:bg-[var(--shell)] enabled:hover:text-white disabled:text-[var(--faint-ink)]">Weiter</button>
          </div>
        </div>
      </>}
    </div>
  </div>;
}

function MemberDialog({ member, onSave, trigger, onNew }: { member?: Member; onSave?: (input: MemberInput, id?: string) => Promise<Member>; trigger: React.ReactElement; onNew?: () => void }) {
  const [open, setOpen] = useState(false); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!onSave) return; setSaving(true); setError('');
    try { await onSave(memberInput(new FormData(event.currentTarget)), member?.id); setOpen(false); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Speichern fehlgeschlagen.'); }
    finally { setSaving(false); }
  }
  const filled = completeness(member);
  return <Dialog open={open} onOpenChange={(next: boolean) => { setOpen(next); if (next) onNew?.(); }}>
    <DialogTrigger render={trigger} />
    <DialogContent showCloseButton={false} className="flex h-[calc(100vh-52px)] max-h-[calc(100vh-52px)] w-[min(980px,100%)] animate-sheet-in flex-col gap-0 overflow-hidden rounded-2xl p-0 shadow-[var(--shadow-sheet)] sm:max-w-[980px]">
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-wrap items-start justify-between gap-5 border-b border-[var(--line-soft)] px-[22px] py-[18px]">
          <div className="flex min-w-0 items-center gap-[13px]">
            <span className="grid size-11 flex-none place-items-center rounded-full bg-[var(--red-soft)] text-[15px] font-semibold text-[var(--red)]">{member ? initials(member) : 'NM'}</span>
            <div className="min-w-0">
              <h2 className="truncate text-[19px] font-semibold -tracking-[0.02em]">{member ? `${member.firstName} ${member.lastName}` : 'Neues Mitglied'}</h2>
              <p className="mt-0.5 truncate font-mono text-[12.5px] text-[var(--muted-ink)]">{member?.memberNumber || 'Nummer wird vergeben'} · Eintritt {member ? dateDe(member.entryDate) : '—'}</p>
            </div>
          </div>
          <div className="flex items-center gap-3.5">
            <div className="min-w-[132px]">
              <div className="flex justify-between gap-2 text-[11px] text-[var(--muted-ink)]"><span>Vollständigkeit</span><span className="font-mono">{filled} %</span></div>
              <div className="mt-[5px] h-[5px] overflow-hidden rounded-full bg-[var(--line-softer)]"><div className="h-[5px] rounded-full bg-[var(--ok-dot)]" style={{ width: `${filled}%` }} /></div>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Schließen" className="size-8 rounded-[9px] bg-[var(--surface)] text-[15px] text-[var(--muted-ink)] shadow-[var(--shadow-hair)] transition hover:bg-[var(--shell)] hover:text-white">×</button>
          </div>
        </div>
        {error && <div className="border-b border-[var(--red-ring)] bg-[var(--red-soft)] px-[22px] py-3 text-[13px] font-medium text-[var(--red-dark)]">{error}</div>}
        <Tabs defaultValue="base" className="flex min-h-0 flex-1 flex-col gap-0">
          <TabsList className="flex h-auto w-full shrink-0 justify-start gap-1.5 overflow-x-auto rounded-none border-b border-[var(--line-soft)] bg-[var(--surface)] px-[22px] py-2.5">
            {[['base', 'Stammdaten'], ['contact', 'Kommunikation'], ['bank', 'Bank & SEPA'], ['fees', 'Abteilungen & Beiträge'], ['roles', 'Funktionen & Ehrungen'], ['postal', 'Postanschrift'], ['custom', 'Zusatzfelder'], ['privacy', 'Notizen & DSGVO']].map(([value, label]) =>
              <TabsTrigger key={value} value={value} className="h-[30px] flex-none whitespace-nowrap rounded-lg px-3 text-[12.5px] font-medium text-[var(--muted-ink)] transition hover:text-[var(--ink)] data-active:bg-white data-active:font-semibold data-active:text-[var(--ink)] data-active:shadow-[0_1px_3px_rgba(23,21,15,.12),var(--shadow-hair)]">{label}</TabsTrigger>)}
          </TabsList>
          <div className="min-h-0 flex-1 overflow-y-auto px-[22px] pb-7 pt-5">
            <EditorTab value="base"><Field label="Mitgliedsnummer" name="memberNumber" defaultValue={member?.memberNumber} /><Field label="Anrede" name="salutation" defaultValue={member?.salutation} /><Field label="Titel" name="title" defaultValue={member?.title} /><Field label="Vorname" name="firstName" defaultValue={member?.firstName} required /><Field label="Nachname" name="lastName" defaultValue={member?.lastName} required /><SelectField label="Geschlecht" name="gender" defaultValue={member?.gender || ''} options={[['', 'Nicht angegeben'], ['m', 'Männlich'], ['w', 'Weiblich'], ['d', 'Divers']]} /><Field label="Geburtsdatum" name="birthDate" type="date" defaultValue={member?.birthDate} /><Field label="Eintritt" name="entryDate" type="date" defaultValue={member?.entryDate} required /><Field label="Austritt" name="exitDate" type="date" defaultValue={member?.exitDate} /><Field label="Austrittsgrund" name="exitReason" defaultValue={member?.exitReason} /><Field label="Straße" name="street" defaultValue={member?.street} wide /><Field label="PLZ" name="postalCode" defaultValue={member?.postalCode} /><Field label="Ort" name="city" defaultValue={member?.city} /><Field label="Land" name="country" defaultValue={member?.country || 'DE'} /></EditorTab>
            <EditorTab value="contact"><Field label="E-Mail" name="email" type="email" defaultValue={member?.email} wide /><Field label="Telefon privat" name="phonePrivate" defaultValue={member?.phonePrivate} /><Field label="Mobil" name="phoneMobile" defaultValue={member?.phoneMobile} /><Field label="Telefon dienstlich" name="phoneBusiness" defaultValue={member?.phoneBusiness} /><Field label="Homepage" name="website" type="url" defaultValue={member?.website} wide /></EditorTab>
            <EditorTab value="bank"><SelectField label="Zahlart" name="paymentMethod" defaultValue={member?.paymentMethod || 's'} options={[['s', 'SEPA-Lastschrift'], ['r', 'Rechnung'], ['b', 'Bar'], ['l', 'Lastschrift (Altbestand)']]} /><Field label="Kontoinhaber" name="accountHolder" defaultValue={member?.accountHolder} /><Field label="IBAN" name="iban" defaultValue={member?.iban} wide /><Field label="BIC" name="bic" defaultValue={member?.bic} /><Field label="Mandatsreferenz" name="mandateReference" defaultValue={member?.mandateReference} /><Field label="Mandat vom" name="mandateSignedAt" type="date" defaultValue={member?.mandateSignedAt} /><SelectField label="Sequenz" name="sepaSequence" defaultValue={member?.sepaSequence || 'RCUR'} options={[['RCUR', 'Wiederkehrend (RCUR)'], ['FRST', 'Erstmalig (FRST)'], ['OOFF', 'Einmalig (OOFF)'], ['FNAL', 'Letztmalig (FNAL)']]} /></EditorTab>
            <EditorTab value="fees"><Field label="Abteilung" name="department" defaultValue={member?.department || 'Fussball'} /><Field label="Abteilungseintritt" name="departmentEntryDate" type="date" defaultValue={member?.departmentEntryDate || member?.entryDate} /><SelectField label="Beitragsart" name="contributionType" defaultValue={member?.contributionType || contributionTypes[0].name} options={contributionTypes.map((item) => [item.name, `${item.code} · ${item.name}`])} /><Field label="Jahresbeitrag (€)" name="annualFee" type="number" step="0.01" defaultValue={String((member?.annualFeeCents ?? 8000) / 100)} required /><SelectField label="Zahlweise" name="paymentFrequency" defaultValue={member?.paymentFrequency || 'j'} options={[['m', 'Monatlich'], ['v', 'Vierteljährlich'], ['h', 'Halbjährlich'], ['j', 'Jährlich'], ['s', 'Sonderzahlweise']]} /></EditorTab>
            <EditorTab value="roles"><Field label="Funktion" name="functionName" defaultValue={member?.functionName} wide /><Area label="Ehrungen" name="honors" defaultValue={member?.honors} placeholder="Ehrung, Datum und Bemerkung" /></EditorTab>
            <EditorTab value="postal"><Area label="Abweichende Postanschrift" name="alternateAddress" defaultValue={member?.alternateAddress} placeholder="Anrede, Name, Zusatz, Straße, PLZ, Ort, Land" /></EditorTab>
            <EditorTab value="custom"><Area label="Benutzerfelder 01–10" name="customFields" defaultValue={typeof member?.customFields === 'string' ? member.customFields : JSON.stringify(member?.customFields || {}, null, 2)} placeholder={'{\n  "Benutzerfeld_01": "…"\n}'} /></EditorTab>
            <EditorTab value="privacy"><Area label="Notizen und Bemerkungen" name="notes" defaultValue={member?.notes} /><Field label="DSGVO zugestimmt am" name="privacyConsentAt" type="date" defaultValue={member?.privacyConsentAt} /><Check label="E-Mail-Kommunikation erlaubt" name="emailConsent" defaultChecked={member?.emailConsent} /><Check label="Bildverwendung erlaubt" name="imageConsent" defaultChecked={member?.imageConsent} /></EditorTab>
          </div>
        </Tabs>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line-soft)] bg-[var(--surface)] px-[22px] py-3">
          <span className="text-[11.5px] text-[var(--muted-ink)]">{member?.spgSyncedAt ? `Zuletzt nach SPG geschrieben ${dateDe(member.spgSyncedAt.slice(0, 10))}` : 'Noch nicht nach SPG geschrieben'}</span>
          <div className="flex gap-2">
            <button type="button" onClick={() => setOpen(false)} className="h-[34px] rounded-[9px] bg-white px-3.5 text-[13px] shadow-[var(--shadow-hair)] transition hover:bg-[var(--line-softer)]">Abbrechen</button>
            <button type="submit" disabled={saving} className="h-[34px] rounded-[9px] bg-[var(--red)] px-4 text-[13px] font-semibold text-white shadow-[0_3px_10px_rgba(200,16,46,.32)] transition hover:bg-[var(--red-dark)] disabled:opacity-60">{saving ? 'Wird gespeichert …' : 'Speichern'}</button>
          </div>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}

function ContributionsView({ members }: { members: Member[] }) {
  const active = members.filter((member) => !member.exitDate);
  const target = active.reduce((sum, member) => sum + member.annualFeeCents, 0);
  const tiers = contributionTypes.map((item, index) => {
    const assigned = active.filter((member) => member.contributionType === item.name);
    const total = assigned.reduce((sum, member) => sum + member.annualFeeCents, 0);
    return { ...item, count: assigned.length, total, share: target ? Math.round((total / target) * 100) : 0, fill: index === 0 ? 'var(--shell)' : index === 2 ? 'var(--red)' : 'var(--shell-badge)' };
  });
  return <div className="animate-fade-up">
    <h1 className="text-[24px] font-semibold -tracking-[0.025em]">Beiträge</h1>
    <p className="mt-[5px] text-[13.5px] text-[var(--muted-ink)]">Jahressoll {euro(target)} aus {active.length} aktiven Mitgliedern</p>
    <div className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(255px,1fr))] gap-3.5">
      {tiers.map((tier) => <div key={tier.code} className="rounded-[14px] bg-white px-[17px] py-4 shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between gap-2.5">
          <span className="rounded-md bg-[var(--red-soft)] px-[7px] py-[3px] font-mono text-[11px] text-[var(--red)]">{tier.code}</span>
          <span className="whitespace-nowrap text-[12px] text-[var(--muted-ink)]">{tier.count} {tier.count === 1 ? 'Mitglied' : 'Mitglieder'}</span>
        </div>
        <p className="mt-[13px] text-pretty text-[14.5px] font-semibold -tracking-[0.01em]">{tier.name}</p>
        <p className="mt-[9px] whitespace-nowrap text-[23px] font-semibold -tracking-[0.025em] tabular-nums">{euro(tier.total)}</p>
        <p className="mt-0.5 text-[12px] text-[var(--muted-ink)]">{euro(tier.amount)} je Mitglied und Jahr</p>
        <div className="mt-[13px] h-1.5 overflow-hidden rounded-full bg-[var(--line-softer)]"><div className="h-1.5 rounded-full" style={{ width: `${tier.share}%`, background: tier.fill }} /></div>
        <p className="mt-2 text-[11.5px] text-[var(--muted-ink)]">{tier.share} % des Jahressolls</p>
      </div>)}
    </div>
  </div>;
}

function SepaView({ members, settings }: { members: Member[]; settings: Settings }) {
  const eligible = members.filter((member) => !member.exitDate && member.paymentMethod === 's' && member.annualFeeCents > 0);
  const total = eligible.reduce((sum, member) => sum + member.annualFeeCents, 0);
  const missingIban = eligible.filter((member) => !member.iban).length;
  const missingMandate = eligible.filter((member) => !member.mandateSignedAt).length;
  const references = new Set(eligible.map((member) => member.mandateReference).filter(Boolean));
  const duplicates = eligible.filter((member) => member.mandateReference).length - references.size;
  const [message, setMessage] = useState(''); const [error, setError] = useState('');
  async function exportSepa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    const response = await fetch('/api/export/sepa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
    if (!response.ok) { const body = await response.json() as { error?: string }; return setError(body.error || 'Export fehlgeschlagen.'); }
    download(await response.blob(), filename(response, 'SEPA.xml')); setMessage('SEPA-Datei wurde erzeugt.');
  }
  const checks = [
    { label: `${eligible.length} Lastschrift-Mitglieder erfasst`, ok: eligible.length > 0, state: eligible.length ? 'geprüft' : 'leer' },
    { label: 'IBAN hinterlegt', ok: missingIban === 0, state: missingIban ? `${missingIban} offen` : 'geprüft' },
    { label: 'Mandatsdatum hinterlegt', ok: missingMandate === 0, state: missingMandate ? `${missingMandate} offen` : 'geprüft' },
    { label: 'Mandatsreferenzen eindeutig', ok: duplicates <= 0, state: duplicates > 0 ? `${duplicates} doppelt` : 'geprüft' },
  ];
  const steps = [['01', 'Bestand prüfen'], ['02', 'Datum & Format'], ['03', 'XML erzeugen']];
  return <div className="animate-fade-up">
    <h1 className="text-[24px] font-semibold -tracking-[0.025em]">SEPA-Lastschrift</h1>
    <p className="mt-[5px] text-[13.5px] text-[var(--muted-ink)]">Lauf vorbereiten — drei Schritte bis zur XML-Datei.</p>
    {(message || error) && <Notice error={error}>{error || message}</Notice>}
    <div className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-4">
      <section className="rounded-[14px] bg-white p-[18px] shadow-[var(--shadow-card)]">
        <div className="flex flex-wrap gap-2.5">
          {steps.map(([num, label], index) => <div key={num} className="min-w-[88px] flex-1 rounded-[11px] px-3 py-[11px]" style={{ background: index === 0 ? 'var(--shell)' : 'var(--surface)', boxShadow: `0 0 0 1px ${index === 0 ? 'var(--shell)' : 'var(--line)'}` }}>
            <span className="font-mono text-[10.5px]" style={{ color: index === 0 ? 'var(--shell-muted)' : 'var(--faint-ink)' }}>{num}</span>
            <p className="mt-1.5 text-[12.5px]" style={{ color: index === 0 ? '#fff' : 'var(--ink)', fontWeight: index === 0 ? 600 : 500 }}>{label}</p>
          </div>)}
        </div>
        <h2 className="mt-5 text-[14.5px] font-semibold">Prüfstatus</h2>
        <div className="mt-3 flex flex-col gap-2">
          {checks.map((check) => <div key={check.label} className="flex items-center justify-between gap-3 rounded-[10px] bg-[var(--surface)] px-3 py-2.5 shadow-[0_0_0_1px_var(--line-soft)]">
            <span className="text-[13px]">{check.label}</span>
            <span className="whitespace-nowrap rounded-full px-[9px] py-[3px] text-[11.5px] font-medium" style={{ background: check.ok ? 'var(--ok-bg)' : 'var(--red-soft)', color: check.ok ? 'var(--ok-fg)' : 'var(--red-dark)' }}>{check.state}</span>
          </div>)}
          {[['pain.008.001.08 verfügbar', 'bereit'], ['Legacy pain.008.001.02 verfügbar', 'bereit']].map(([label, state]) =>
            <div key={label} className="flex items-center justify-between gap-3 rounded-[10px] bg-[var(--surface)] px-3 py-2.5 shadow-[0_0_0_1px_var(--line-soft)]">
              <span className="text-[13px]">{label}</span>
              <span className="whitespace-nowrap rounded-full bg-[var(--info-bg)] px-[9px] py-[3px] text-[11.5px] font-medium text-[var(--info-fg)]">{state}</span>
            </div>)}
        </div>
      </section>
      <form onSubmit={exportSepa} className="rounded-[14px] bg-[var(--shell)] p-5 text-[var(--shell-fg)] shadow-[0_14px_40px_rgba(23,21,15,.28)]">
        <p className="text-[11.5px] uppercase tracking-[0.14em] text-[var(--shell-muted)]">Nächster Lauf</p>
        <p className="mt-3.5 text-[38px] font-semibold leading-none -tracking-[0.03em] tabular-nums">{amount(total)}</p>
        <p className="mt-[5px] text-[12.5px] text-[var(--shell-muted)]">EUR aus {eligible.length} Mandaten</p>
        <div className="mt-[18px] flex flex-col gap-3">
          <div>
            <label htmlFor="collectionDate" className="block text-[11px] uppercase tracking-[0.1em] text-[var(--shell-muted)]">Einzugsdatum</label>
            <input id="collectionDate" name="collectionDate" type="date" required className="mt-1.5 h-9 w-full rounded-[9px] border-0 bg-white/10 px-[11px] text-[13.5px] text-[var(--shell-fg)] outline-none [color-scheme:dark]" />
          </div>
          <div>
            <label htmlFor="format" className="block text-[11px] uppercase tracking-[0.1em] text-[var(--shell-muted)]">XML-Format</label>
            <select id="format" name="format" defaultValue="pain.008.001.08" className="mt-1.5 h-9 w-full rounded-[9px] border-0 bg-white/10 px-[9px] text-[13.5px] text-[var(--shell-fg)] outline-none">
              <option className="text-[var(--ink)]" value="pain.008.001.08">Aktuell · pain.008.001.08</option>
              <option className="text-[var(--ink)]" value="pain.008.001.02">SPG-Legacy · pain.008.001.02</option>
            </select>
          </div>
        </div>
        <button type="submit" disabled={!eligible.length} className="mt-[18px] h-10 w-full rounded-[10px] bg-[var(--red)] text-[13.5px] font-semibold text-white shadow-[0_6px_18px_rgba(200,16,46,.4)] transition hover:bg-[var(--red-bright)] disabled:opacity-50">SEPA-XML erzeugen</button>
        {settings.iban && <p className="mt-3 font-mono text-[11px] text-[var(--shell-muted)]">{settings.iban}</p>}
      </form>
    </div>
  </div>;
}

function SpgView({ members, onImported }: { members: Member[]; onImported: () => Promise<void> }) {
  const [status, setStatus] = useState<BridgeStatus | null>(null); const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const check = useCallback(async () => {
    setLoading(true); setError('');
    try { const response = await fetch('/api/spg/status'); setStatus(await response.json() as BridgeStatus); }
    catch { setStatus({ connected: false, compatible: false, reason: 'Status konnte nicht gelesen werden.' }); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void check(); }, [check]);
  async function importMembers() {
    setLoading(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/spg/import', { method: 'POST' });
      const body = await response.json() as { error?: string; imported?: number; updated?: number; skipped?: number };
      if (!response.ok) throw new Error(body.error || 'Import fehlgeschlagen.');
      await onImported();
      setMessage(`${body.imported || 0} Mitglieder neu eingelesen, ${body.updated || 0} aktualisiert, ${body.skipped || 0} lokale Änderungen übersprungen.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Import fehlgeschlagen.'); }
    finally { setLoading(false); }
  }
  async function exportBackup() {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/export/spg-backup', { method: 'POST' });
      if (!response.ok) { const body = await response.json() as { error?: string }; throw new Error(body.error || 'Sicherung fehlgeschlagen.'); }
      download(await response.blob(), filename(response, 'GUT_SPG_Sicherung.zip'));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Sicherung fehlgeschlagen.'); }
    finally { setLoading(false); }
  }
  const pending = members.filter((member) => !member.spgSyncedAt).length;
  const canExport = Boolean(status?.compatible && (pending === 0 || status.writeCompatible));
  const lines = [
    { label: 'Brücke erreichbar', ok: Boolean(status?.connected), state: status?.connected ? 'ja' : 'nein' },
    { label: `SQL Server (erwartet ${status?.expectedSqlServerMajor ?? '–'})`, ok: Boolean(status?.sqlServerMajor && status.sqlServerMajor === status.expectedSqlServerMajor), state: String(status?.sqlServerMajor ?? '–') },
    { label: `Datenbankformat (erwartet ${status?.expectedDatabaseVersion ?? '–'})`, ok: Boolean(status?.databaseVersion && status.databaseVersion === status.expectedDatabaseVersion), state: String(status?.databaseVersion ?? '–') },
    { label: 'Mandant (erwartet GUT)', ok: status?.mandant === 'GUT', state: status?.mandant ?? '–' },
    { label: 'SPG-Schreiben freigegeben', ok: Boolean(status?.writeCompatible), state: status?.writeCompatible ? 'frei' : 'gesperrt' },
  ];
  return <div className="animate-fade-up">
    <h1 className="text-[24px] font-semibold -tracking-[0.025em]">SPG-Sicherung</h1>
    <p className="mt-[5px] text-[13.5px] text-[var(--muted-ink)]">Originalformat statt CSV-Ersatz — erzeugt über die Windows-Brücke.</p>
    {(error || message) && <Notice error={error}>{error || message}</Notice>}
    <div className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-4">
      <section className="rounded-[14px] bg-white p-[18px] shadow-[var(--shadow-card)]">
        <h2 className="text-[14.5px] font-semibold">Windows-Brücke</h2>
        <div className="mt-[13px] flex flex-col gap-2">
          {lines.map((line) => <div key={line.label} className="flex items-center justify-between gap-3 rounded-[10px] bg-[var(--surface)] px-3 py-2.5 shadow-[0_0_0_1px_var(--line-soft)]">
            <span className="text-[13px]">{line.label}</span>
            <span className="whitespace-nowrap rounded-full px-[9px] py-[3px] font-mono text-[11.5px] font-medium" style={{ background: line.ok ? 'var(--ok-bg)' : 'var(--red-soft)', color: line.ok ? 'var(--ok-fg)' : 'var(--red-dark)' }}>{line.state}</span>
          </div>)}
        </div>
        {status?.reason && <div className="mt-4 rounded-[11px] bg-[var(--warn-bg)] px-3.5 py-[13px] shadow-[0_0_0_1px_rgba(138,90,18,.18)]">
          <p className="text-[13px] font-semibold text-[var(--warn-fg)]">Derzeit nicht bereit</p>
          <p className="mt-1 text-pretty text-[12.5px] text-[var(--warn-fg)]">{status.reason}</p>
        </div>}
        {pending > 0 && !status?.writeCompatible && <div className="mt-4 rounded-[11px] bg-[var(--red-soft)] px-3.5 py-[13px] shadow-[0_0_0_1px_var(--red-ring)]">
          <p className="text-[13px] font-semibold text-[var(--red-dark)]">Schreibfreigabe ausstehend</p>
          <p className="mt-1 text-pretty text-[12.5px] text-[var(--red-deep)]">{pending} Webapp-Datensätze wandern erst nach bestandenem Roundtrip-Test ins ZIP. Bis dahin entsteht kein scheinbar passendes Archiv.</p>
        </div>}
      </section>
      <aside className="rounded-[14px] bg-white p-[18px] shadow-[var(--shadow-card)]">
        <p className="text-[11.5px] uppercase tracking-[0.12em] text-[var(--muted-ink)]">Bereit zur Sicherung</p>
        <p className="mt-3 text-[38px] font-semibold leading-none -tracking-[0.03em] tabular-nums">{pending}</p>
        <p className="mt-1 text-[12.5px] text-[var(--muted-ink)]">neue oder geänderte Datensätze</p>
        <button onClick={importMembers} disabled={!status?.compatible || loading} className="mt-[18px] h-[38px] w-full rounded-[10px] bg-[var(--surface)] text-[13.5px] font-medium shadow-[var(--shadow-hair)] transition enabled:hover:bg-[var(--line-softer)] disabled:text-[var(--faint-ink)]">Bestand aus SPG einlesen</button>
        <button onClick={exportBackup} disabled={!canExport || loading} className="mt-2 h-[38px] w-full rounded-[10px] text-[13.5px] font-medium transition enabled:bg-[var(--red)] enabled:text-white enabled:shadow-[var(--shadow-red)] enabled:hover:bg-[var(--red-dark)] disabled:bg-[var(--canvas)] disabled:text-[var(--faint-ink)] disabled:shadow-[0_0_0_1px_var(--line-dim)]">SPG-ZIP erstellen</button>
        <button onClick={check} disabled={loading} className="mt-2 h-[38px] w-full rounded-[10px] text-[13px] text-[var(--muted-ink)] transition hover:bg-[var(--surface)]">Verbindung erneut prüfen</button>
        {!canExport && <p className="mt-[11px] text-pretty text-[11.5px] text-[var(--muted-ink)]">Gesperrt, bis <span className="font-mono">EnableWrites</span> in der Brücke aktiv ist.</p>}
      </aside>
    </div>
  </div>;
}

function SettingsView({ settings, onSaved }: { settings: Settings; onSaved: () => Promise<void> }) {
  const [message, setMessage] = useState(''); const [error, setError] = useState('');
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
    const body = await response.json() as { error?: string };
    if (!response.ok) return setError(body.error || 'Speichern fehlgeschlagen.');
    await onSaved(); setMessage('Einstellungen gespeichert.'); setError('');
  }
  return <div className="max-w-[760px] animate-fade-up">
    <h1 className="text-[24px] font-semibold -tracking-[0.025em]">Einstellungen</h1>
    <p className="mt-[5px] text-[13.5px] text-[var(--muted-ink)]">Vereins- und Bankdaten für SEPA-Läufe und Rechnungen.</p>
    {(message || error) && <Notice error={error}>{error || message}</Notice>}
    <form onSubmit={save} className="mt-5 rounded-[14px] bg-white p-5 shadow-[var(--shadow-card)]">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-x-[18px] gap-y-3.5">
        <Field label="Vereinsname" name="clubName" defaultValue={settings.clubName} wide required />
        <Field label="Gläubiger-ID" name="creditorId" defaultValue={settings.creditorId} />
        <Field label="Nachrichtenkürzel" name="sepaMessagePrefix" defaultValue={settings.sepaMessagePrefix || 'GUT-WEB'} />
        <Field label="Vereins-IBAN" name="iban" defaultValue={settings.iban} wide />
        <Field label="BIC" name="bic" defaultValue={settings.bic} />
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line-soft)] pt-[15px]">
        <p className="text-[11.5px] text-[var(--muted-ink)]">Geheimnisse bleiben in der Docker-Umgebung.</p>
        <button type="submit" className="h-9 rounded-[9px] bg-[var(--shell)] px-4 text-[13px] font-medium text-white shadow-[var(--shadow-ink)] transition hover:bg-[var(--shell-hover)]">Speichern</button>
      </div>
    </form>
  </div>;
}

const fieldClass = 'mt-1.5 h-9 w-full rounded-[9px] border-0 bg-[var(--surface)] px-[11px] text-[13.5px] shadow-[var(--shadow-hair)] outline-none focus-visible:bg-white focus-visible:shadow-[0_0_0_3px_rgba(200,16,46,.18)]';
const labelClass = 'block text-[11.5px] font-medium text-[var(--muted-ink)]';

function EditorTab({ value, children }: { value: string; children: React.ReactNode }) { return <TabsContent value={value}><div className="grid min-h-[340px] grid-cols-[repeat(auto-fit,minmax(215px,1fr))] gap-x-[18px] gap-y-3.5 content-start">{children}</div></TabsContent>; }
function Field({ label, name, type = 'text', required = false, wide = false, ...props }: { label: string; name: string; type?: string; required?: boolean; wide?: boolean; [key: string]: unknown }) {
  return <div className={wide ? 'sm:col-span-2' : ''}><Label htmlFor={name} className={labelClass}>{label}</Label><Input id={name} name={name} type={type} required={required} className={fieldClass} placeholder="Noch nicht erfasst" {...props} /></div>;
}
function SelectField({ label, name, options, defaultValue }: { label: string; name: string; options: string[][]; defaultValue?: string }) {
  return <div><Label htmlFor={name} className={labelClass}>{label}</Label><NativeSelect id={name} name={name} defaultValue={defaultValue} className={fieldClass}>{options.map(([value, title]) => <NativeSelectOption key={value} value={value}>{title}</NativeSelectOption>)}</NativeSelect></div>;
}
function Area({ label, name, defaultValue, placeholder }: { label: string; name: string; defaultValue?: string; placeholder?: string }) {
  return <div className="sm:col-span-2 lg:col-span-3"><Label htmlFor={name} className={labelClass}>{label}</Label><Textarea id={name} name={name} defaultValue={defaultValue} placeholder={placeholder} className="mt-1.5 min-h-36 rounded-[9px] border-0 bg-[var(--surface)] px-[11px] py-2.5 text-[13.5px] shadow-[var(--shadow-hair)] outline-none focus-visible:bg-white focus-visible:shadow-[0_0_0_3px_rgba(200,16,46,.18)]" /></div>;
}
function Check({ label, name, defaultChecked }: { label: string; name: string; defaultChecked?: boolean }) {
  return <label className="flex items-center gap-3 self-start rounded-[11px] bg-[var(--surface)] px-3.5 py-3 text-[13px] shadow-[var(--shadow-hair)]"><input type="checkbox" name={name} defaultChecked={defaultChecked} className="size-4 accent-[var(--red)]" /><span>{label}</span></label>;
}
function Notice({ error, children }: { error?: string; children: React.ReactNode }) {
  return <div className="mt-5 rounded-[11px] px-3.5 py-3 text-[13px] font-medium" style={{ background: error ? 'var(--red-soft)' : 'var(--ok-bg)', color: error ? 'var(--red-dark)' : 'var(--ok-fg)', boxShadow: `0 0 0 1px ${error ? 'var(--red-ring)' : 'rgba(63,97,48,.18)'}` }}>{children}</div>;
}

function usesSepa(member: Member) { return member.paymentMethod === 's' && Boolean(member.iban); }
function memberStatus(member: Member): MemberStatus {
  if (member.exitDate) return 'Ausgetreten';
  if (member.paymentMethod === 's' && (!member.iban || !member.mandateSignedAt)) return 'Prüfen';
  return 'Aktiv';
}
function statusTone(status: MemberStatus) {
  if (status === 'Aktiv') return { fg: 'var(--ok-fg)', bg: 'var(--ok-bg)' };
  if (status === 'Prüfen') return { fg: 'var(--red-dark)', bg: 'var(--red-soft)' };
  return { fg: 'var(--muted-ink)', bg: 'var(--line-dim)' };
}
function yearHistory(members: Member[]) {
  const now = new Date().getFullYear();
  return Array.from({ length: 8 }, (_, index) => {
    const year = now - 7 + index;
    const end = new Date(`${year}-12-31T12:00:00Z`);
    const held = members.filter((member) => member.entryDate && new Date(member.entryDate) <= end && (!member.exitDate || new Date(member.exitDate) > end));
    return { year, count: held.length, target: held.reduce((sum, member) => sum + member.annualFeeCents, 0) };
  });
}
function spark(values: number[], accent: string) {
  const max = Math.max(1, ...values);
  return values.map((value, index) => ({ h: `${Math.round((value / max) * 26) + 2}px`, fill: index === values.length - 1 ? accent : 'var(--line-warm)' }));
}
// Nulllinie statt Min/Max: bei kleinen Beständen soll ein einzelner Ab- oder
// Zugang keinen dramatischen Ausschlag vortäuschen.
function barHeight(value: number, all: number[]) {
  const max = Math.max(1, ...all);
  return `${Math.round((value / max) * 84) + 18}px`;
}
function upcomingMoments(members: Member[]) {
  const now = new Date(); const month = now.getMonth();
  const inMonth = (value?: string) => Boolean(value) && new Date(`${value}T12:00:00Z`).getMonth() === month;
  const moments: Array<{ key: string; tag: string; kind: string; name: string; detail: string; date: string; highlight: boolean }> = [];
  for (const member of members) {
    if (member.exitDate) continue;
    const name = `${member.firstName} ${member.lastName}`;
    if (inMonth(member.entryDate)) {
      const years = now.getFullYear() - new Date(member.entryDate).getFullYear();
      if (years > 0 && years % 25 === 0) moments.push({ key: `j-${member.id}`, tag: String(years), kind: 'Jubiläum', name, detail: `${years} Jahre im Verein — eine Ehrung steht an.`, date: dateDe(member.entryDate), highlight: true });
    }
    if (member.birthDate && inMonth(member.birthDate)) {
      const age = now.getFullYear() - new Date(member.birthDate).getFullYear();
      if (age > 0 && age % 10 === 0) moments.push({ key: `b-${member.id}`, tag: String(age), kind: 'Geburtstag', name, detail: `Wird ${age} — ein runder Geburtstag.`, date: dateDe(member.birthDate), highlight: false });
    }
  }
  const joined = members.filter((member) => inMonth(member.entryDate) && new Date(member.entryDate).getFullYear() === now.getFullYear());
  if (joined.length) moments.push({ key: 'new', tag: pad(joined.length), kind: 'Neuzugänge', name: joined.length === 1 ? `${joined[0].firstName} ${joined[0].lastName}` : `${joined.length} neue Mitglieder`, detail: 'Aufnahme abgeschlossen, Beiträge werden fällig.', date: monthLabel(), highlight: false });
  return moments.slice(0, 3);
}
function completeness(member?: Member) {
  if (!member) return 0;
  const keys: Array<keyof Member> = ['salutation', 'birthDate', 'street', 'postalCode', 'city', 'email', 'phonePrivate', 'entryDate', 'department', 'contributionType', 'paymentMethod', 'iban', 'bic', 'mandateReference', 'mandateSignedAt', 'privacyConsentAt'];
  const filled = keys.filter((key) => Boolean(member[key])).length;
  return Math.round((filled / keys.length) * 100);
}
function exportCsv(members: Member[]) {
  const head = ['Mitgliedsnummer', 'Vorname', 'Nachname', 'Abteilung', 'Eintritt', 'Jahresbeitrag', 'Status', 'E-Mail', 'IBAN'];
  const rows = members.map((member) => [member.memberNumber, member.firstName, member.lastName, member.department || '', member.entryDate, (member.annualFeeCents / 100).toFixed(2), memberStatus(member), member.email || '', member.iban || '']);
  const csv = [head, ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  download(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }), 'Mitglieder.csv');
}
function pad(value: number) { return String(value).padStart(2, '0'); }
function today() { return new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date()); }
function monthLabel() { return new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(new Date()); }

function memberInput(data: FormData): MemberInput { return { memberNumber: formText(data, 'memberNumber'), salutation: formText(data, 'salutation'), title: formText(data, 'title'), firstName: formText(data, 'firstName'), lastName: formText(data, 'lastName'), gender: formText(data, 'gender'), birthDate: formText(data, 'birthDate'), street: formText(data, 'street'), postalCode: formText(data, 'postalCode'), city: formText(data, 'city'), country: formText(data, 'country'), phonePrivate: formText(data, 'phonePrivate'), phoneMobile: formText(data, 'phoneMobile'), phoneBusiness: formText(data, 'phoneBusiness'), email: formText(data, 'email'), website: formText(data, 'website'), entryDate: formText(data, 'entryDate'), exitDate: formText(data, 'exitDate'), exitReason: formText(data, 'exitReason'), department: formText(data, 'department'), departmentEntryDate: formText(data, 'departmentEntryDate'), contributionType: formText(data, 'contributionType'), annualFeeCents: Math.round(Number(data.get('annualFee')) * 100), paymentFrequency: formText(data, 'paymentFrequency'), paymentMethod: formText(data, 'paymentMethod'), accountHolder: formText(data, 'accountHolder'), iban: formText(data, 'iban'), bic: formText(data, 'bic'), mandateReference: formText(data, 'mandateReference'), mandateSignedAt: formText(data, 'mandateSignedAt'), sepaSequence: formText(data, 'sepaSequence'), functionName: formText(data, 'functionName'), honors: formText(data, 'honors'), alternateAddress: formText(data, 'alternateAddress'), customFields: formText(data, 'customFields'), notes: formText(data, 'notes'), privacyConsentAt: formText(data, 'privacyConsentAt'), imageConsent: data.get('imageConsent') === 'on', emailConsent: data.get('emailConsent') === 'on' }; }
function formText(data: FormData, key: string) { const value = data.get(key); return typeof value === 'string' ? value : ''; }
function initials(member: Member) { return `${member.firstName[0] || ''}${member.lastName[0] || ''}`.toUpperCase(); }
function dateDe(value?: string) { return value ? new Intl.DateTimeFormat('de-DE').format(new Date(`${value}T12:00:00Z`)) : '–'; }
function euro(cents: number) { return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(cents / 100); }
function amount(cents: number) { return new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100); }
function filename(response: Response, fallback: string) { return response.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || fallback; }
function download(blob: Blob, name: string) { const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url); }
