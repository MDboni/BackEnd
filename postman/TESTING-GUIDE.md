# MessMate API — Postman Testing Guide

Kon API ki kaj kore, ar kibhabe check dibe — puro tar bornona.

---

## 1. Setup

### Postman-e import

1. Postman khulo → **Import** → ei duita file dao:
   - `MessMate.postman_collection.json` — 99 request, 13 folder
   - `MessMate.postman_environment.json` — `baseUrl` variable
2. Upor-e daan pashe environment dropdown theke **"MessMate — Local"** select koro

### Server chalu

```bash
cd backend
pnpm dev        # http://localhost:5000
```

Onno terminal-e:

```bash
pnpm seed       # demo data — mess, 6 member, 1 mash-er meal/expense/deposit
```

> `pnpm seed` **barbar chalano jay**. Eta shudhu data dhokay na — mash gulo abar OPEN kore dey ar password reset kore. Test korte korte kichu gorbor hoye gele ekbar `pnpm seed` chalale age-r obosthay fire jabe.

### Seed account

| Role | Email | Ki korte pare | Ki pare na |
| --- | --- | --- | --- |
| OWNER | `owner@messmate.test` | Sob | — |
| MANAGER | `manager@messmate.test` | Expense, deposit, member, month **close** | Reopen, role change |
| ACCOUNTANT | `accountant@messmate.test` | Expense, deposit, report, **preview** | Month close, role change |
| COOK | `cook@messmate.test` | Shudhu meal count | **Kono taka-poisar data** |
| MEMBER | `member1@messmate.test` | Nijer meal/deposit/statement | Onner data, admin kaj |

Password sob gulor: `Messmate123` · Invite code: `DEMO2026`

---

## 2. Kibhabe chalabe

### Poddhoti A — ekta ekta kore (bujhe bujhe)

Ei tinta **age chalao**, na hole baki gulo `{{messId}}` khali peye fail korbe:

```
01 · Auth → Login — Owner            ⭐  (accessToken save hoy)
01 · Auth → Me                       ⭐  (messId, membershipId save hoy)
01 · Auth → Setup — load current period ⭐  (periodId save hoy)
```

Erpor je kono folder-e jao. **Prati request-er "Documentation" tab-e** (daan pashe) bistarito lekha ache — ki kore, ke korte pare, ki expect korbe, ki cheshta kore dekhte paro.

### Poddhoti B — puro collection ekbare

Collection-er upor **···** → **Run collection** → folder `00` theke `11` porjonto select koro → Run.

**`12 · Destructive` folder ta bad dao** — oita password bodlay ar ownership transfer kore.

**Prottasha: 96 request, 103 assertion, 0 failure.** (Eta sotti kore chaliye dekha hoyeche — Run 1 ar Run 2, dutoitei 103/103 pass.)

---

## 3. Auto-save — hate kore id copy korte hobe na

Test script gulo response theke id ber kore nijei variable-e rakhe:

| Variable | Kothay set hoy |
| --- | --- |
| `accessToken` | Je kono login |
| `messId`, `membershipId` | `01 · Auth → Me` |
| `periodId` | `01 · Auth → Setup`, ar `07 → List periods` |
| `targetMembershipId` | `03 → List members` |
| `expenseId` | `05 → Create FOOD expense` |
| `depositId` | `06 → Create deposit` |
| `inviteCode` | `03 → Create invitation` |
| `joinEmail` | `01 · Auth → Register` |

Date gulo-o auto — **Dhaka timezone dhore**, tomar computer-er timezone jai hok:
`{{today}}`, `{{tomorrow}}`, `{{plus2}}`, `{{plus3}}`, `{{farFuture}}`, `{{currentMonth}}`

---

## 4. Folder gulo ki kore

### `00 · Health` (3)
Server ar database beche ache kina. Token lage na.
`/health/ready` database-e sotti query kore — kono request 500 dile eta diye bujhbe problem ta app-e naki DB-te.

### `01 · Auth` (6)
Login, token, refresh rotation.

**Interesting jinish:** "Refresh token" **duibar por por** chalao. Dwitiybar `401` ashbe ar tumi logged out hoye jabe. Karon: eki refresh token duibar ashle system dhore ney token ta churi hoyeche, ar oi user-er **sob session revoke** kore dey.

### `02 · Mess` (4)
Mess toiri ar settings. Mess banale tumi **automatic OWNER** — duitai ek transaction-e, tai owner-bihin mess kokhono hoy na.

`cutoffDaysAhead` ar `mealCutoffTime` ekhane bodlano jay — tarpor `04 · Meals`-er cutoff behaviour bodle jabe. Cheshta kore dekho.

### `03 · Members & Invitations` (12)
Invite code banano → preview → notun account diye join → duibar join korle `409`.

**Invite code shudhu ekbar dekha jay** — database-e shudhu SHA-256 hash thake, server-er kacheo plaintext nei.

Ei folder ta **nijei account switch kore** ar shesh-e Owner-e fire ase.

### `04 · Meals` (12)
Sob cheye beshi byabohrito ongsho.

**Cutoff rule ek line-e:** member `aj` theke `aj + cutoffDaysAhead` din porjonto edit korte pare, ar `aj`-ke shudhu `mealCutoffTime` er age porjonto.

Tinta niyom bhangar test ache — purono date (`403`), onek samner date (`403`), `0.7` quantity (`400`).

**Manager override** cutoff bypass kore, **kintu**:
- `reason` chhara `400`
- Month closed hole tao `409` — override cutoff bypass kore, **closed month na**

### `05 · Expenses` (12)
**Sob cheye guruttopurno niyom ekhane:** khabar-er kharcha meal rate-e jay; bhara/bidyut meal rate-e **kokhono** meshe na.

Char rokom allocation-er char-tai ache, ar **duita ichchhe kore bhul request**:
- `FOOD + EQUAL` → `400` (khabar soman bhag kora jabe na — je beshi kheyeche se beshi debe)
- `RENT + MEAL_BASED` → `400` (bhara meal rate-e dhukte pare na)

**CUSTOM allocation-e** share gulor jog **thik** amount-er soman hote hobe. Ekta amount bodle dao — `422` ashbe ar bolbe koto poisa gorme.

**DELETE mane void** — database theke mochhe na, `reason` lage.

### `06 · Deposits` (7)
Joma, ferot, adjustment. **REFUND biyog hoy**, baki tinta jog.

Member **nijer deposit nije likhte pare na** — nahole je keu bolte parto "ami 5000 diyechi".

### `07 · Periods & Month Close` (11) — **system-er hridoy**

Puro flow ekta folder-e:

```
List periods → Preview → CLOSE → CLOSE again (409)
  → closed month-e likha (409) → REOPEN → bad-pora expense jog → Re-CLOSE (v2)
```

**Preview** ta sob cheye guruttopurno API. Eta close korle **thik ja hoto** seta hisheb kore dekhay, kintu **kichu likhe na** — joto bar khushi chalao.

Response-e ja dekhbe:

| Field | Mane |
| --- | --- |
| `canClose` | Ekhon close kora jabe kina |
| `issues[]` | `error` = close atkabe, `warning` = shudhu janay |
| `mealRate` | `totalFoodExpense ÷ totalMealUnits` |
| `members[].closingBalance` | `+` mane mess tar kache dey, `−` mane se dey |

**Nije jachai koro:** `totalGrossCost` = `totalFoodExpense + totalFixedCost + totalPersonalCost` — **thik milte hobe**. Test script eta automatic check kore. Na milele API nijei `RECONCILIATION_MISMATCH` error dey.

> Ei folder ta **age-r ekta mash** (seed-er July) niye kaj kore, cholti mash na. Karon eta mash close kore dey — cholti mash bandhle `05` ar `06` folder dwitiybar chalanor somoy closed month-e likhte giye `409` kheto.

### `08 · Statements` (4)
Close kora maser chuda-nto hisheb.

**"My statement history"** dekho — reopen korar por **duita version** dekhabe (v1 ar v2). Purono ta mochhe na. Tai member jigges korle "ager bar amar 3773 chilo, ekhon 4100 keno" — dutoi dekhiye uttor dewa jay.

### `09 · Dashboards` (3)
Tin role-er tin rokom home screen.

Sob gulotei `isProvisional: true` — mash close na hoya porjonto rate bodlate thakbe, karon nichher bhagfol (mot meal) barte thake.

**Cook dashboard-e ekta taka-o nei** — cook-er financial data dekhar odhikar nei, tai API-teo pathano hoy na.

### `10 · Audit Log` (3)
Ke, kokhon, ki bodleche.

`action=MEAL_OVERRIDE` diye filter koro — kar meal ke bodlalo ar **keno** (reason soho), ar age/pore-r puro snapshot.

**Password ba token kokhono ekhane ashe na** — logger-e redact kora, tai notun code likhleo bhul kore faash hobe na.

### `11 · Security & RBAC` (19) — **ekhane fail hoya-i pass**

Ei folder ta nijei role bodlay (`↪ Login as ...`) ar shesh-e Owner-e fire ase, tai ekbare puro folder chalano jay.

| Test | Expect | Ki proman kore |
| --- | --- | --- |
| No token | `401` | Cookie mucheo dekha hoy — nahole test mithye pass korto |
| COOK → expenses / deposits / audit | `403` | Randhuni taka-poisa dekhe na |
| COOK → cook dashboard | `200` ✅ | RBAC shudhu "na" bole na, thik jinish "ha" bole |
| MEMBER → member list / create expense | `403` | Member admin kaj kore na |
| MEMBER → own deposits | `200` ✅ | Nijer ta nijei dekhe |
| MEMBER/MANAGER → reopen | `403` | Reopen shudhu OWNER-er |
| MANAGER → change role | `403` | Manager nijei sob khomota niye nite pare na |
| Foreign messId | **`404`** | `403` bolle bujha jeto "mess ta ache" — seta-o tothyo faash |
| Invalid UUID | `400` | Ulto-palta id DB porjonto pouchhay na |

### `12 · Destructive` (3) — ⚠️ hate kore
Password change, ownership transfer, logout. **"Run collection"-e chalio na.**

Chaliye felle `pnpm seed` chalao — password ar role fire ashbe.

---

## 5. Status code-er mane

| Code | Mane | Kokhon dekhbe |
| --- | --- | --- |
| `400` | Request-er gathon bhul | `0.7` meal, invalid UUID, reason missing |
| `401` | Login-i koro nai / token expired | Token chhara, ba replay kora refresh token |
| `403` | Login ache, odhikar nei | Cook → expense, Manager → reopen |
| `404` | Ei mess-e jinish ta nei | Onno mess-er id (ichchhe kore 404) |
| `409` | Conflict | Duibar close, closed month-e likha, duibar join |
| `422` | Business rule bhengeche | Share-er jog na milla, reconciliation mismatch |
| `429` | Rate limit | Development-e onek beshi limit, tai sadharonoto dekhbe na |

---

## 6. Somossha hole

**Sob request `400` dicche, `{{messId}}` literal dekhacche**
→ `01 · Auth → Login — Owner`, tarpor `Me` chalao.

**`409 "This month is closed"`**
→ Mash close kore felecho. `07 → REOPEN` chalao, ba `pnpm seed` diye reset koro.

**`401` ashche kintu login korechilam**
→ Access token 15 minute-e expire hoy. Abar login koro, ba `Refresh token` chalao.

**`429 Too Many Requests`**
→ Development-e limit onek boro (auth-e 15 min-e 200)। Peleo 15 minute por nije-i thik hoye jabe. Production-e ei limit 10.

**"No token → 401" test-e `200` ashche**
→ Cookie jar-e purono cookie. Request-er pre-request script eta muche dey — kintu Postman-e domain-er jonno programmatic cookie access lagte pare. Postman-er **Cookies** (URL bar-er niche) theke `localhost` mucheo dekhte paro.

**Onek data jome geche, poriskar kore shuru korte chai**
→ `pnpm seed` — mash gulo OPEN hobe, statement mochbe, password reset hobe.
Puropuri notun kore korte hole: `pnpm prisma migrate reset` (⚠️ sob data mochbe), tarpor `pnpm seed`.
