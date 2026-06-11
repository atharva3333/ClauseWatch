import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, AlertTriangle, ArrowUpRight, Bot, CalendarClock, CheckCircle2,
  ChevronRight, CircleDollarSign, FileSearch, FileText, LayoutDashboard,
  MessageSquareText, RefreshCw, Search, ShieldAlert, Trash2, Upload, X,
} from "lucide-react";

const severityRank = { Critical: 0, High: 1, Medium: 2, Low: 3 };
const money = (value) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1,
}).format(value);

function App() {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("overview");
  const [selectedRisk, setSelectedRisk] = useState(null);
  const [selectedContract, setSelectedContract] = useState(null);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [chat, setChat] = useState([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const fileRef = useRef(null);

  const load = async () => {
    const response = await fetch("/api/portfolio");
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to load portfolio");
    setData(result);
    return result;
  };
  useEffect(() => { load(); }, []);

  const filteredContracts = useMemo(() => {
    if (!data) return [];
    return data.contracts.filter((item) =>
      `${item.name} ${item.party} ${item.type}`.toLowerCase().includes(query.toLowerCase()));
  }, [data, query]);

  async function uploadContract(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setNotice(null);
    const body = new FormData();
    body.append("contract", file);
    try {
      const response = await fetch("/api/contracts", { method: "POST", body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Contract processing failed");
      await load();
      setNotice({ type: "success", text: `${result.contract.name} was extracted, indexed, and analyzed.` });
      setSelectedContract(result.contract);
      setTab("contracts");
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  async function sendMessage(event) {
    event.preventDefault();
    if (!message.trim() || busy) return;
    const prompt = message.trim();
    setChat((items) => [...items, { role: "user", text: prompt }]);
    setMessage("");
    setBusy(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: prompt }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The agent could not answer");
      setChat((items) => [...items, { role: "agent", text: result.answer }]);
    } catch (error) {
      setChat((items) => [...items, { role: "agent error", text: error.message }]);
    } finally {
      setBusy(false);
    }
  }

  async function analyzeNow() {
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/analyze", { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Portfolio analysis failed");
      await load();
      setNotice({ type: "success", text: `Portfolio analysis completed with ${result.risks.length} supported findings.` });
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    } finally {
      setBusy(false);
    }
  }

  async function removeContract(contract) {
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/contracts/${encodeURIComponent(contract.id)}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to delete contract");
      setSelectedContract(null);
      await load();
      setNotice({ type: "success", text: `${contract.name} was removed and the risk register was rebuilt.` });
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <div className="loading"><Activity className="spin" /> Loading portfolio...</div>;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">CW</div><span>ClauseWatch</span></div>
        <nav>
          <Nav icon={LayoutDashboard} label="Overview" active={tab === "overview"} onClick={() => setTab("overview")} />
          <Nav icon={ShieldAlert} label="Risk register" count={data.summary.openRisks} active={tab === "risks"} onClick={() => setTab("risks")} />
          <Nav icon={FileText} label="Contracts" active={tab === "contracts"} onClick={() => setTab("contracts")} />
          <Nav icon={MessageSquareText} label="Ask the agent" active={tab === "agent"} onClick={() => setTab("agent")} />
        </nav>
        <div className="sidebar-foot">
          <div className="live-dot"><span /> Portfolio monitor active</div>
          <small>Daily audit scheduled</small>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <p className="eyebrow">Contract intelligence</p>
            <h1>{tab === "overview" ? "Portfolio command center" : tab === "risks" ? "Risk register" : tab === "contracts" ? "Contracts" : "Ask Contract Risk Agent"}</h1>
          </div>
          <div className="header-actions">
            <button className="secondary" onClick={analyzeNow} disabled={busy || !data.contracts.length} title="Rebuild risk register"><RefreshCw size={17} /> Analyze</button>
            <button className="primary" onClick={() => fileRef.current?.click()} disabled={busy}>
              <Upload size={17} /> {busy ? "Analyzing..." : "Add contract"}
            </button>
          </div>
          <input ref={fileRef} type="file" accept=".pdf,.txt,.md" hidden onChange={uploadContract} />
        </header>

        {notice && <div className={`notice ${notice.type}`}><span>{notice.text}</span><button onClick={() => setNotice(null)} aria-label="Dismiss notification"><X size={16} /></button></div>}
        {tab === "overview" && <Overview data={data} onRisk={setSelectedRisk} onViewRisks={() => setTab("risks")} />}
        {tab === "risks" && <Risks risks={data.risks} onRisk={setSelectedRisk} />}
        {tab === "contracts" && <Contracts contracts={filteredContracts} query={query} setQuery={setQuery} onContract={setSelectedContract} onUpload={() => fileRef.current?.click()} />}
        {tab === "agent" && <Agent agents={data.agents} chat={chat} message={message} setMessage={setMessage} sendMessage={sendMessage} busy={busy} />}
      </main>
      {selectedRisk && <RiskDrawer risk={selectedRisk} close={() => setSelectedRisk(null)} />}
      {selectedContract && <ContractDrawer contract={selectedContract} close={() => setSelectedContract(null)} remove={() => removeContract(selectedContract)} busy={busy} />}
    </div>
  );
}

function Nav({ icon: Icon, label, count, active, onClick }) {
  return <button className={`nav-item ${active ? "active" : ""}`} onClick={onClick}><Icon size={18} /><span>{label}</span>{count ? <b>{count}</b> : null}</button>;
}

function Overview({ data, onRisk, onViewRisks }) {
  const risks = [...data.risks].sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
  return <div className="content">
    <section className="metrics">
      <Metric icon={FileSearch} label="Contracts monitored" value={data.summary.totalContracts} meta="Across customers and vendors" />
      <Metric icon={CircleDollarSign} label="Active contract value" value={money(data.summary.activeValue)} meta="Portfolio exposure" />
      <Metric icon={AlertTriangle} label="Urgent risks" value={data.summary.urgentRisks} meta="Require prompt attention" warn />
      <Metric icon={CalendarClock} label="Next deadline" value={`${data.deadlines[0]?.daysRemaining ?? "—"} days`} meta={data.deadlines[0]?.contract || "No deadlines"} />
    </section>

    <section className="split">
      <div className="panel">
        <div className="panel-head"><div><p className="eyebrow">Priority queue</p><h2>Risks that need action</h2></div><button className="text-button" onClick={onViewRisks}>View all <ArrowUpRight size={15} /></button></div>
        <div className="risk-list">
          {!risks.length && <EmptyState title="No risks yet" text={data.contracts.length ? "Run portfolio analysis to generate evidence-backed findings." : "Upload contracts to begin building the risk register."} />}
          {risks.map((risk) => <button className="risk-row" key={risk.id} onClick={() => onRisk(risk)}>
            <span className={`severity ${risk.severity.toLowerCase()}`}>{risk.severity}</span>
            <span className="risk-copy"><strong>{risk.title}</strong><small>{risk.category} · {risk.contracts.length} contracts</small></span>
            <span className="confidence">{risk.confidence}%</span><ChevronRight size={17} />
          </button>)}
        </div>
      </div>
      <div className="panel deadline-panel">
        <div className="panel-head"><div><p className="eyebrow">Time pressure</p><h2>Upcoming deadlines</h2></div></div>
        {!data.deadlines.length && <EmptyState title="No deadlines found" text="Expiration and renewal dates will appear after contract extraction." />}
        {data.deadlines.slice(0, 4).map((item) => <div className="deadline" key={item.id}>
          <div className="date-block"><b>{new Date(`${item.deadline}T12:00:00`).toLocaleDateString("en-US", { month: "short" })}</b><span>{new Date(`${item.deadline}T12:00:00`).getDate()}</span></div>
          <div><strong>{item.contract}</strong><small>{item.event} · {item.exposure}</small></div>
          <span className={`days ${item.daysRemaining < 0 ? "overdue" : ""}`}>{item.daysRemaining < 0 ? `${Math.abs(item.daysRemaining)}d late` : `${item.daysRemaining}d`}</span>
        </div>)}
      </div>
    </section>

    <section className="agent-strip">
      <div><p className="eyebrow">Agent activity</p><h2>Four specialists, one risk register</h2></div>
      <div className="agents">{data.agents.map((agent) => <div className="agent-chip" key={agent.name}><span><CheckCircle2 size={15} /></span><div><b>{agent.name}</b><small>{agent.task}</small></div></div>)}</div>
    </section>
  </div>;
}

function Metric({ icon: Icon, label, value, meta, warn }) {
  return <div className={`metric ${warn ? "warn" : ""}`}><div className="metric-top"><span>{label}</span><Icon size={19} /></div><b>{value}</b><small>{meta}</small></div>;
}

function Risks({ risks, onRisk }) {
  return <div className="content"><div className="register-head"><p>{risks.length} evidence-backed findings across the connected portfolio.</p><div className="legend"><span className="dot critical" />Critical <span className="dot high" />High</div></div>
    {!risks.length && <div className="panel"><EmptyState title="Risk register is empty" text="Upload at least one contract, then analyze the portfolio. Cross-contract findings become stronger after two or more related agreements are indexed." /></div>}
    <div className="risk-grid">{risks.map((risk) => <button className="risk-card" key={risk.id} onClick={() => onRisk(risk)}>
      <div className="risk-card-top"><span className={`severity ${risk.severity.toLowerCase()}`}>{risk.severity}</span><span>{risk.status} · {risk.confidence}%</span></div>
      <h3>{risk.title}</h3><p>{risk.summary}</p>
      <div className="risk-card-foot"><span>{risk.category}</span><span>{risk.contracts.length} contracts <ChevronRight size={15} /></span></div>
    </button>)}</div></div>;
}

function Contracts({ contracts, query, setQuery, onContract, onUpload }) {
  return <div className="content"><div className="searchbar"><Search size={18} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search contracts, parties, or type" /></div>
    {!contracts.length && !query && <div className="panel"><EmptyState title="No contracts in Elasticsearch" text="Upload a PDF, TXT, or MD agreement. Gemini will extract it and store the structured result in your Elastic index." action="Upload contract" onAction={onUpload} /></div>}
    {contracts.length > 0 && <div className="table-wrap"><table><thead><tr><th>Contract</th><th>Party</th><th>Type</th><th>Version</th><th>Value</th><th>Status</th></tr></thead>
      <tbody>{contracts.map((contract) => <tr className="clickable-row" key={contract.id} onClick={() => onContract(contract)}><td><div className="doc-name"><FileText size={17} /><div><b>{contract.name}</b><small>{contract.expirationDate ? `Expires ${contract.expirationDate}` : "No expiration date found"}</small></div></div></td><td>{contract.counterparty || contract.party || "Not found"}</td><td>{contract.contractType || contract.type}</td><td>{contract.version || "Not found"}</td><td>{contract.value ? money(contract.value) : "—"}</td><td><span className={`status ${String(contract.status).toLowerCase()}`}>{contract.status}</span></td></tr>)}</tbody>
    </table></div>}</div>;
}

function Agent({ agents, chat, message, setMessage, sendMessage, busy }) {
  const prompts = ["What are my highest priority risks?", "Compare customer promises with vendor protection", "Which clauses changed in the Acme renewal?"];
  return <div className="content agent-layout"><aside className="agent-roster"><p className="eyebrow">Active team</p>{agents.map((agent) => <div className="roster-item" key={agent.name}><span><Bot size={17} /></span><div><b>{agent.name}</b><small>{agent.state}</small></div></div>)}</aside>
    <section className="chat-panel"><div className="chat-intro"><div className="bot-mark"><Bot size={23} /></div><h2>Contract Risk Agent</h2><p>Ask about conflicts, obligation gaps, renewals, or clause changes. Every answer is grounded in portfolio evidence.</p></div>
      {!chat.length && <div className="prompt-grid">{prompts.map((prompt) => <button key={prompt} onClick={() => setMessage(prompt)}>{prompt}<ArrowUpRight size={15} /></button>)}</div>}
      <div className="messages">{chat.map((item, index) => <div className={`message ${item.role}`} key={index}>{item.text}</div>)}{busy && <div className="message agent typing">Specialists are reviewing the portfolio...</div>}</div>
      <form className="composer" onSubmit={sendMessage}><input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Ask a portfolio risk question..." /><button aria-label="Send question"><ArrowUpRight size={18} /></button></form>
    </section></div>;
}

function RiskDrawer({ risk, close }) {
  return <div className="drawer-backdrop" onMouseDown={close}><aside className="drawer" onMouseDown={(e) => e.stopPropagation()}>
    <div className="drawer-head"><span className={`severity ${risk.severity.toLowerCase()}`}>{risk.severity}</span><button className="icon-button" onClick={close} aria-label="Close"><X size={20} /></button></div>
    <p className="eyebrow">{risk.category}</p><h2>{risk.title}</h2><p className="lead">{risk.summary}</p>
    <div className="fact-line"><span>Status</span><b>{risk.status}</b><span>Confidence</span><b>{risk.confidence}%</b></div>
    <h3>Supporting evidence</h3>{risk.evidence.map((item, index) => <blockquote key={index}><b>{item.contract} · §{item.section}</b><p>“{item.text}”</p></blockquote>)}
    <h3>Business impact</h3><p>{risk.impact}</p><h3>Recommended action</h3><div className="action-box">{risk.action}</div>
    <small className="legal-note">AI-generated contract risk analysis. Qualified legal review is recommended.</small>
  </aside></div>;
}

function ContractDrawer({ contract, close, remove, busy }) {
  return <div className="drawer-backdrop" onMouseDown={close}><aside className="drawer" onMouseDown={(event) => event.stopPropagation()}>
    <div className="drawer-head"><span className={`status ${String(contract.status).toLowerCase()}`}>{contract.status}</span><button className="icon-button" onClick={close} aria-label="Close"><X size={20} /></button></div>
    <p className="eyebrow">{contract.contractType || contract.type}</p><h2>{contract.name}</h2><p className="lead">{contract.summary || "No contract summary was extracted."}</p>
    <div className="contract-facts">
      <div><span>Counterparty</span><b>{contract.counterparty || contract.party || "Not found"}</b></div>
      <div><span>Version</span><b>{contract.version || "Not found"}</b></div>
      <div><span>Effective</span><b>{contract.effectiveDate || "Not found"}</b></div>
      <div><span>Expires</span><b>{contract.expirationDate || "Not found"}</b></div>
      <div><span>Value</span><b>{contract.value ? money(contract.value) : "Not found"}</b></div>
      <div><span>Indexed</span><b>{contract.uploadedAt ? new Date(contract.uploadedAt).toLocaleString() : "Not found"}</b></div>
    </div>
    <h3>Extracted clauses</h3>
    {!contract.clauses?.length && <p>No risk-relevant clauses were extracted.</p>}
    {contract.clauses?.map((clause, index) => <blockquote key={`${clause.section}-${index}`}><b>{clause.category} · §{clause.section || "Not found"}</b><p>{clause.text}</p>{clause.value && <small>{clause.value}</small>}</blockquote>)}
    <button className="danger-button" onClick={remove} disabled={busy}><Trash2 size={16} /> Remove contract</button>
  </aside></div>;
}

function EmptyState({ title, text, action, onAction }) {
  return <div className="empty-state"><FileSearch size={25} /><strong>{title}</strong><p>{text}</p>{action && <button className="secondary" onClick={onAction}>{action}</button>}</div>;
}

export default App;
