# VIP Channels — Members Site

Login / Register · User homepage with 3 packages · Locked buttons · Coffee-bean carousel · Contact link · Upgrade QR · Full admin panel.
Zero dependencies — just Node 18+.

## Pages
| URL | What |
|---|---|
| `/login` and `/register` | Log in / create account. Every new account is **FREE ACCOUNT** (badge top-right). |
| `/` | User homepage: Free Plan (5 buttons), Package A (20), Package B (50), coffee carousel, Contact us. |
| `/admin` | Admin panel (admins only). |

## Admin panel
- **General** – site title, subtitle, carousel heading, footer, Contact us link, "Send receipt here" link, lock-popup text.
- **Packages & buttons** – name, label, price, description, and every button's name + link (add/remove buttons too).
- **Payment QR** – upload a new QR, or restore the original `public/qr.png`.
- **Coffee carousel** – upload photos (many at once), add captions, reorder, remove.
- **Users & tiers** – upgrade anyone to Package A / B (or back to Free), make admins, reset passwords, delete users.
- **My account** – change your admin password.

Locked button links are never sent to users who haven't unlocked that package.

---

## 1) Put it on GitHub
1. Create a new empty repo on github.com.
2. Upload **all files in this folder** (drag & drop works: `server.js`, `package.json`, `README.md`, `.gitignore`, and the `public` folder).

## 2) Deploy on Railway
1. Railway → **New Project → Deploy from GitHub repo** → pick your repo. It runs `npm start` automatically.
2. **Add a Volume (important — keeps users, links & photos saved):**
   Service → **Settings → Volumes → Add Volume**, mount path: `/data`
3. **Variables** tab — add:
   | Name | Value |
   |---|---|
   | `DATA_DIR` | `/data` |
   | `ADMIN_USERNAME` | your admin username (e.g. `owner`) |
   | `ADMIN_PASSWORD` | a strong password |
4. **Settings → Networking → Generate Domain.** Open it and log in with your admin username/password → you land on `/admin`.

> Without the Volume, everything (users, uploads, edits) is wiped on each redeploy.
> The admin account is created only on the very first start. If you skip `ADMIN_PASSWORD`, it's `admin` / `changeme123` — change it right away in **Admin → My account**.

## Upgrade flow
User taps a locked button → "This is locked" popup → **Upgrade now** → QR + price → they pay and tap **Send receipt here** → you open **Admin → Users & tiers** and switch them to Package A or B → locks open instantly.

## Run locally
`npm start` → http://localhost:3000 (data saved in `./data`)
