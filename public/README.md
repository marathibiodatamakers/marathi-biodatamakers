# मराठी बायोडाटा मेकर — GitHub Deploy Guide

## ✅ Files in this folder (upload ALL to GitHub)

| File | Purpose |
|------|---------|
| `index.html` | Main app — all SEO fixes applied |
| `robots.txt` | Fixed — Googlebot gets crawl-delay: 0 |
| `sitemap.xml` | Fixed — hreflang + image sitemap added |
| `google7e0f42273dc732fc.html` | Google Search Console verification |

---

## 🚀 GitHub + Render Deploy Steps

### Step 1 — Push to GitHub
```bash
git add index.html robots.txt sitemap.xml google7e0f42273dc732fc.html
git commit -m "SEO fix: verification tag, title, sitemap, robots"
git push
```

### Step 2 — Render auto-deploys
Render will detect the push and redeploy automatically (1-2 minutes).

### Step 3 — Verify files are live
Open these URLs in your browser:
- https://marathibiodatamakers.onrender.com/google7e0f42273dc732fc.html → must show: `google-site-verification: google7e0f42273dc732fc.html`
- https://marathibiodatamakers.onrender.com/robots.txt → must show the robots file
- https://marathibiodatamakers.onrender.com/sitemap.xml → must show XML

---

## 🔍 Google Search Console (do this once after deploy)

1. Go to https://search.google.com/search-console
2. Add property → `https://marathibiodatamakers.onrender.com/`
3. Choose **HTML tag** verification → verify (your meta tag is now live in index.html)
4. Go to **Sitemaps** → enter `sitemap.xml` → Submit
5. Go to **URL Inspection** → paste your URL → click **Request Indexing**
6. Wait 1–7 days ✅

---

## 🕐 Cron Job Setup (Server-Side Keep-Alive — FREE)

Your site sleeps after 15 min on Render free tier.
Fix: set up a **server-side** cron that pings every 10 min — works 24/7.

1. Go to **https://cron-job.org** → Create free account
2. Dashboard → **Create cronjob**
3. URL: `https://marathibiodatamakers.onrender.com/`
4. Execution schedule: **Every 10 minutes**
5. Save & Enable

Your site will NEVER sleep again. 🎉

---

## 🔺 IMPORTANT — Upload og-image.jpg

Your OG image URL `https://marathibiodatamakers.onrender.com/og-image.jpg` must exist.

Create a **1200×630 JPG** showing your biodata maker and upload it as `og-image.jpg` in your GitHub repo root.

Without this, WhatsApp/Facebook/Google image preview will break.

---

## SEO Fixes Applied in index.html

| Fix | Before | After |
|-----|--------|-------|
| Google verification | **commented out** ❌ | Active ✅ |
| Title | Marathi first | **English keyword first** ✅ |
| Meta description | No CTA | **CTA + ₹25** added ✅ |
| Keep-alive | Client-only | **cron-job.org instructions** added ✅ |
