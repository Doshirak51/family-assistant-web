import { createClient } from "https://esm.sh/@supabase/supabase-js@2.111.0";

const cfg = window.FAMILY_ASSISTANT_CONFIG || {};
const app = document.querySelector("#app");
const money = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
let sb;
let session;
let state = { household: null, membership: null, categories: [], tab: "today" };

const $ = (selector) => document.querySelector(selector);
const el = (name, className, text) => { const node = document.createElement(name); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
const formatMoney = (value) => `${money.format(Number(value || 0))} ₽`;
const monthStart = () => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
const dateText = (value) => new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(new Date(value));
const errorText = (error) => error?.message || "Что-то пошло не так. Попробуйте ещё раз.";
const initials = (name) => (name || "С").trim().slice(0, 1).toUpperCase();

function clear() { app.replaceChildren(); }
function button(label, className = "primary", handler) { const b = el("button", className, label); b.type = "button"; if (handler) b.addEventListener("click", handler); return b; }
function top(title, subtitle = "Family Assistant") { const header = el("header", "top"); const text = el("div"); text.append(el("p", "eyebrow", subtitle), el("h1", "", title)); header.append(text, el("div", "avatar", initials(session?.user?.user_metadata?.full_name || session?.user?.email))); return header; }
function row(icon, title, meta, right, rightClass = "") { const node = el("article", "row"); node.append(el("div", `round-icon ${rightClass}`, icon)); const info = el("div", "row-main"); info.append(el("b", "", title), el("span", "", meta)); node.append(info); if (right !== undefined) node.append(el("div", `amount ${rightClass}`, right)); return node; }
function listOrEmpty(rows, emptyText) { const box = el("div", "list"); if (!rows.length) box.append(el("p", "empty", emptyText)); else rows.forEach((item) => box.append(item)); return box; }

async function query(table) { const result = await sb.from(table).select("*").eq("household_id", state.household.id); if (result.error) throw result.error; return result.data || []; }
async function loadHousehold() {
  const member = await sb.from("family_web_members").select("household_id, role, family_web_households(*)").eq("user_id", session.user.id).maybeSingle();
  if (member.error) throw member.error;
  if (!member.data) return false;
  state.membership = member.data; state.household = member.data.family_web_households;
  const cat = await sb.from("family_web_categories").select("*").eq("household_id", state.household.id).eq("kind", "expense").order("position");
  if (cat.error) throw cat.error; state.categories = cat.data || [];
  return true;
}

function showConfig() {
  clear(); const card = el("section", "auth"); card.append(el("div", "logo-mark", "♥"), el("h1", "", "Сначала подключим Supabase"), el("p", "lead", "Сайт готов. Осталось вставить два публичных значения из вашего проекта Supabase."));
  const panel = el("div", "auth-card"); panel.append(el("p", "", "Откройте файл config.js и добавьте Project URL и publishable/anon key. Secret key туда не вставляйте.")); card.append(panel); app.append(card);
}
function showLogin(message = "") {
  clear();
  const section = el("section", "auth");
  section.append(
    el("div", "logo-mark", "♥"),
    el("h1", "", "Ваш общий дом для планов и денег"),
    el("p", "lead", "Вход по e‑mail и паролю. Никаких писем и дополнительной настройки почты.")
  );
  const card = el("div", "auth-card");
  let mode = "signin";

  const drawForm = () => {
    card.replaceChildren();
    const switcher = el("div", "auth-switch");
    const signInMode = button("Войти", `auth-mode ${mode === "signin" ? "active" : ""}`, () => { mode = "signin"; drawForm(); });
    const signUpMode = button("Создать доступ", `auth-mode ${mode === "signup" ? "active" : ""}`, () => { mode = "signup"; drawForm(); });
    switcher.append(signInMode, signUpMode);

    const form = el("form", "form");
    let name;
    if (mode === "signup") {
      const nameLabel = el("label", "", "Как вас называть?");
      name = el("input", "input");
      name.autocomplete = "name";
      name.placeholder = "Например, Дарина";
      name.maxLength = 80;
      name.required = true;
      nameLabel.append(name);
      form.append(nameLabel);
    }
    const emailLabel = el("label", "", "Ваш e‑mail");
    const email = el("input", "input");
    email.type = "email";
    email.autocomplete = "email";
    email.placeholder = "name@example.com";
    email.required = true;
    emailLabel.append(email);
    const passwordLabel = el("label", "", "Пароль");
    const password = el("input", "input");
    password.type = "password";
    password.autocomplete = mode === "signup" ? "new-password" : "current-password";
    password.placeholder = "Минимум 8 символов";
    password.minLength = 8;
    password.required = true;
    passwordLabel.append(password);
    const alert = el("p", "alert hidden");
    const submit = button(mode === "signup" ? "Создать доступ" : "Войти");
    submit.type = "submit";
    form.append(emailLabel, passwordLabel, alert, submit);
    if (message) form.prepend(el("p", "alert", message));
    form.append(el("p", "auth-note", mode === "signup" ? "Письмо не придёт: пароль нужен, чтобы войти с любого устройства." : "Первый раз на сайте? Нажмите «Создать доступ»."));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      submit.disabled = true;
      alert.classList.add("hidden");
      const credentials = { email: email.value.trim(), password: password.value };
      const result = mode === "signup"
        ? await sb.auth.signUp({ ...credentials, options: { data: { full_name: name.value.trim() } } })
        : await sb.auth.signInWithPassword(credentials);
      if (result.error) {
        submit.disabled = false;
        alert.textContent = result.error.message.includes("Email signups are disabled")
          ? "В Supabase включите Email в Authentication → Configuration → Sign In / Providers."
          : errorText(result.error);
        alert.classList.remove("hidden");
        return;
      }
      if (!result.data.session) {
        submit.disabled = false;
        alert.textContent = "В Supabase отключите Confirm email: Authentication → Configuration → Sign In / Providers → Email.";
        alert.classList.remove("hidden");
        return;
      }
      session = result.data.session;
      await boot();
    });
    card.append(switcher, form);
  };
  drawForm();
  section.append(card);
  app.append(section);
}
function showSetup() {
  clear(); const section = el("section", "auth"); const invite = new URLSearchParams(location.search).get("invite"); section.append(el("div", "logo-mark", "♥"), el("h1", "", invite ? "Вас ждут в семье" : "Создадим ваше пространство"), el("p", "lead", invite ? "Подтвердите вход — и вы присоединитесь к общему дому." : "Один раз задайте название. Затем пригласите Кристину личной ссылкой."));
  const panel = el("div", "setup-card"); const alert = el("p", "alert hidden"); panel.append(alert);
  if (invite) { const join = button("Присоединиться к семье"); join.addEventListener("click", async () => { join.disabled = true; const { error } = await sb.rpc("family_web_redeem_invite", { p_token: invite }); if (error) { alert.textContent = errorText(error); alert.classList.remove("hidden"); join.disabled = false; } else { history.replaceState({}, "", location.pathname); await boot(); } }); panel.append(join); }
  else { const form = el("form", "form"); const label = el("label", "", "Как назовём ваше пространство?"); const name = el("input", "input"); name.value = "Дарина ❤️ Кристина"; name.maxLength = 80; label.append(name); form.append(label); const create = button("Создать семейное пространство"); create.type = "submit"; form.append(create); form.addEventListener("submit", async (event) => { event.preventDefault(); create.disabled = true; const { error } = await sb.rpc("family_web_create_household", { p_name: name.value.trim() }); if (error) { alert.textContent = errorText(error); alert.classList.remove("hidden"); create.disabled = false; } else await boot(); }); panel.append(form); } section.append(panel); app.append(section);
}

async function getData() {
  const [transactions, tasks, events, lists, members] = await Promise.all([query("family_web_transactions"), query("family_web_tasks"), query("family_web_events"), query("family_web_shopping_lists"), sb.from("family_web_members").select("role, family_web_profiles(full_name)").eq("household_id", state.household.id)]);
  if (members.error) throw members.error;
  const listIds = lists.map((x) => x.id); let items = [];
  if (listIds.length) { const result = await sb.from("family_web_shopping_items").select("*").in("list_id", listIds).order("created_at"); if (result.error) throw result.error; items = result.data || []; }
  return { transactions, tasks, events, lists, items, members: members.data || [] };
}
function navigation(active) { const nav = el("nav", "tabbar"); [["today","⌂","Сегодня"],["finance","₽","Бюджет"],["plans","✓","Планы"],["family","♥","Семья"]].forEach(([id,icon,label]) => { const b = el("button", `tab ${active===id?"active":""}`); b.type="button"; b.append(el("i","",icon),el("span","",label)); b.addEventListener("click",()=>{state.tab=id;render();}); nav.append(b); }); return nav; }
async function render() { clear(); try { const data = await getData(); if (state.tab === "today") renderToday(data); if (state.tab === "finance") renderFinance(data); if (state.tab === "plans") renderPlans(data); if (state.tab === "family") renderFamily(data); app.append(navigation(state.tab)); } catch (error) { showLogin(`Не удалось загрузить данные: ${errorText(error)}`); } }
function renderToday(data) {
  app.append(top(state.household.name)); const start = monthStart(); const monthTransactions = data.transactions.filter((item)=>item.occurred_at >= start); const income = monthTransactions.filter(x=>x.kind==="income").reduce((sum,x)=>sum+Number(x.amount),0); const expense = monthTransactions.filter(x=>x.kind==="expense").reduce((sum,x)=>sum+Number(x.amount),0); const balance = data.transactions.reduce((sum,x)=>sum+(x.kind==="income"?Number(x.amount):-Number(x.amount)),0);
  const hero = el("section","hero"); hero.append(el("p","","Доступно сейчас"),el("strong","",formatMoney(balance)),el("small","",`Ваша семья · ${data.members.length}/2 участника`)); app.append(hero);
  const stats=el("section","stats"); const plus=el("article","stat"); plus.append(el("span","","↑ Доходы за месяц"),el("strong","income",formatMoney(income))); const minus=el("article","stat"); minus.append(el("span","","↓ Расходы за месяц"),el("strong","expense",formatMoney(expense))); stats.append(plus,minus); app.append(stats,button("＋ Добавить операцию","primary",()=>openTransaction()));
  const today = new Date(); const dayEnd = new Date(today); dayEnd.setDate(dayEnd.getDate()+7); const cards=[]; data.tasks.filter(x=>!x.completed_at).slice(0,3).forEach(x=>cards.push(["✓",x.title,x.due_at?`до ${dateText(x.due_at)}`:"задача"])); data.events.filter(x=>new Date(x.starts_at)>=today&&new Date(x.starts_at)<=dayEnd).slice(0,3).forEach(x=>cards.push(["◷",x.title,dateText(x.starts_at)]));
  const sec=el("section","section"); const head=el("div","section-head"); head.append(el("h2","","Ближайшее"),button("Все планы","link-button",()=>{state.tab="plans";render();})); sec.append(head); const grid=el("div","today-grid"); if(!cards.length)grid.append(el("p","empty","На ближайшую неделю ничего не запланировано.")); cards.slice(0,4).forEach(([i,t,m])=>{const c=el("article","today-card");c.append(el("div","round-icon",i));const x=el("div");x.append(el("strong","",t),el("span","",m));c.append(x);grid.append(c)});sec.append(grid);app.append(sec);
}
function renderFinance(data) { app.append(top("Бюджет",state.household.name)); const sec=el("section","section"); const head=el("div","section-head");head.append(el("h2","","Все операции"),button("＋ Добавить","link-button",()=>openTransaction()));sec.append(head); const rows=data.transactions.sort((a,b)=>new Date(b.occurred_at)-new Date(a.occurred_at)).map(x=>row(x.kind==="income"?"↑":"↓",x.note||x.kind==="income"?"Доход":"Расход",dateText(x.occurred_at),`${x.kind==="income"?"+":"−"}${formatMoney(x.amount)}`,x.kind)); sec.append(listOrEmpty(rows,"Пока нет операций. Добавьте первую — и появится история.")); app.append(sec,button("＋ Добавить операцию","floating",()=>openTransaction())); }
function renderPlans(data) { app.append(top("Планы",state.household.name)); const taskSec=el("section","section");const h=el("div","section-head");h.append(el("h2","","Задачи"),button("＋ Новая","link-button",()=>openTask()));taskSec.append(h);const taskRows=data.tasks.filter(x=>!x.completed_at).sort((a,b)=>(a.due_at||"").localeCompare(b.due_at||"")).map(x=>{const n=el("article","row");const check=el("input","check");check.type="checkbox";check.checked=Boolean(x.completed_at);check.addEventListener("change",()=>toggleTask(x.id,check.checked));n.append(check);const m=el("div","row-main");m.append(el("b","",x.title),el("span","",x.due_at?`до ${dateText(x.due_at)}`:"без срока"));n.append(m);return n});taskSec.append(listOrEmpty(taskRows,"Список задач пока пуст."));app.append(taskSec);
  const eSec=el("section","section");const eHead=el("div","section-head");eHead.append(el("h2","","Календарь"),button("＋ Событие","link-button",()=>openEvent()));eSec.append(eHead);const erows=data.events.sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at)).slice(0,8).map(x=>row("◷",x.title,dateText(x.starts_at),new Date(x.starts_at).toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"})));eSec.append(listOrEmpty(erows,"Добавьте первое событие — оно появится здесь."));app.append(eSec); }
function renderFamily(data) { app.append(top("Семья",state.household.name)); const sec=el("section","section");sec.append(el("h2","","Вместе"));const memberBox=el("div","list"); data.members.forEach(x=>{const node=el("div","member");node.append(el("div","avatar",initials(x.family_web_profiles?.full_name)));const t=el("div");t.append(el("span","",x.family_web_profiles?.full_name||"Участник"),el("small","",x.role==="owner"?"Владелец пространства":"Участник семьи"));node.append(t);memberBox.append(node)});sec.append(memberBox);app.append(sec);const invite=button("Пригласить второго человека","primary",openInvite);invite.disabled=data.members.length>=2;app.append(invite);
  const sSec=el("section","section");const sh=el("div","section-head");sh.append(el("h2","","Покупки"),button("＋ Добавить","link-button",()=>openShopping(data.lists)));sSec.append(sh);const rows=data.items.filter(x=>!x.completed_at).slice(0,8).map(x=>{const n=el("article","row");const c=el("input","check");c.type="checkbox";c.addEventListener("change",()=>toggleShop(x.id,c.checked));n.append(c);const main=el("div","row-main");main.append(el("b","",x.title));n.append(main);return n});sSec.append(listOrEmpty(rows,"Здесь будет общий список покупок."));app.append(sSec); }
function dialog(title) { const d=el("dialog","modal"); const h=el("div","modal-top");const x=el("div");x.append(el("p","eyebrow","Family Assistant"),el("h2","",title));h.append(x,button("×","icon-button",()=>d.close()));d.append(h);document.body.append(d);return d; }
function field(label, type="text", value="") { const l=el("label","",label);const i=el(type==="select"?"select":"input",type==="select"?"select":"input");if(type!=="select")i.type=type;i.value=value;l.append(i);return [l,i]; }
function submitForm(d, form, save) { const submit = form.querySelector("button.primary"); if (submit) submit.type = "submit"; const alert=el("p","alert hidden");form.append(alert);form.addEventListener("submit",async(e)=>{e.preventDefault();const btn=form.querySelector("button[type=submit]");btn.disabled=true;try{await save();d.close();await render()}catch(error){alert.textContent=errorText(error);alert.classList.remove("hidden");btn.disabled=false}});d.append(form);d.showModal(); }
function openTransaction(){const d=dialog("Новая операция");const f=el("form","form");const [type,kind]=field("Тип","select");[["expense","Расход"],["income","Доход"]].forEach(([v,t])=>{const o=el("option","",t);o.value=v;kind.append(o)});const [amount,amountI]=field("Сумма, ₽","number");amountI.min="0.01";amountI.step="0.01";amountI.required=true;const [category,cat]=field("Категория","select");state.categories.forEach(x=>{const o=el("option","",x.name);o.value=x.id;cat.append(o)});const [note,noteI]=field("Комментарий — необязательно");f.append(type,amount,category,note,button("Сохранить","primary"));kind.addEventListener("change",()=>category.classList.toggle("hidden",kind.value==="income"));submitForm(d,f,async()=>{const {error}=await sb.from("family_web_transactions").insert({household_id:state.household.id,kind:kind.value,amount:Number(amountI.value),category_id:kind.value==="expense"?cat.value:null,note:noteI.value.trim()||null,created_by:session.user.id});if(error)throw error});}
function openTask(){const d=dialog("Новая задача");const f=el("form","form");const [t,i]=field("Что нужно сделать?");i.required=true;const [date,dt]=field("Срок — необязательно","date");f.append(t,date,button("Добавить задачу","primary"));submitForm(d,f,async()=>{const {error}=await sb.from("family_web_tasks").insert({household_id:state.household.id,title:i.value.trim(),due_at:dt.value?new Date(dt.value).toISOString():null,created_by:session.user.id});if(error)throw error});}
function openEvent(){const d=dialog("Новое событие");const f=el("form","form");const [t,i]=field("Название");i.required=true;const [date,dt]=field("Дата и время","datetime-local");dt.required=true;f.append(t,date,button("Добавить событие","primary"));submitForm(d,f,async()=>{const {error}=await sb.from("family_web_events").insert({household_id:state.household.id,title:i.value.trim(),starts_at:new Date(dt.value).toISOString(),created_by:session.user.id});if(error)throw error});}
async function toggleTask(id,done){const {error}=await sb.from("family_web_tasks").update({completed_at:done?new Date().toISOString():null}).eq("id",id);if(error){alert(errorText(error));await render()}}
function openShopping(lists){const d=dialog("Добавить покупку");const f=el("form","form");const [t,i]=field("Что купить?");i.required=true;f.append(t,button("Добавить","primary"));submitForm(d,f,async()=>{let list=lists[0];if(!list){const r=await sb.from("family_web_shopping_lists").insert({household_id:state.household.id,title:"Покупки",created_by:session.user.id}).select().single();if(r.error)throw r.error;list=r.data}const {error}=await sb.from("family_web_shopping_items").insert({list_id:list.id,title:i.value.trim(),created_by:session.user.id});if(error)throw error});}
async function toggleShop(id,done){const {error}=await sb.from("family_web_shopping_items").update({completed_at:done?new Date().toISOString():null}).eq("id",id);if(error){alert(errorText(error));await render()}}
async function openInvite(){const d=dialog("Пригласить партнёра");const p=el("p","", "Ссылка одноразовая и действует 7 дней. Отправьте её только второму участнику семьи.");d.append(p);const load=el("p","loading-line show","Создаём ссылку…");d.append(load);d.showModal();const {data,error}=await sb.rpc("family_web_create_invite");load.classList.remove("show");if(error){d.append(el("p","alert",errorText(error)));return}const input=el("input","input");input.readOnly=true;input.value=`${location.origin}${location.pathname}?invite=${data}`;const copy=button("Скопировать ссылку","primary",async()=>{await navigator.clipboard.writeText(input.value);copy.textContent="Скопировано ✓"});d.append(input,copy)}
async function boot(){clear();app.append(el("section","state-card","Загружаем данные…"));const have=await loadHousehold();if(!have)return showSetup();await render();}
async function start(){if(!cfg.supabaseUrl||!cfg.supabaseAnonKey)return showConfig();sb=createClient(cfg.supabaseUrl,cfg.supabaseAnonKey);const result=await sb.auth.getSession();session=result.data.session;if(session?.user?.is_anonymous){await sb.auth.signOut();session=null;}sb.auth.onAuthStateChange(async(_event,newSession)=>{session=newSession;if(session)await boot();else showLogin()});if(!session)return showLogin();await boot();}
start().catch((error)=>showLogin(errorText(error)));
