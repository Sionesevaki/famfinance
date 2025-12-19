Below is a copy/paste-able Keycloak configuration checklist (Realm + Clients + PKCE + Redirect URIs + Token settings) that works great for a web app + mobile app + admin frontend + Node/Nest API.

I’ll assume:

Keycloak base URL (dev): http://localhost:8080

Realm: family-finance

Web frontend: http://localhost:3000

Admin frontend: http://localhost:3001

API: http://localhost:4000

(Mobile examples included for Expo + native)

1) Realm settings
Create Realm

Realm name: family-finance

Realm → Login

User registration: ON (optional if you want users to self-register)

Forgot password: ON

Remember me: ON (optional)

Email as username: ON (recommended)

Login with email: ON

Realm → Tokens

Good production defaults:

Access token lifespan: 5 minutes

Client login timeout: 1 minute

SSO Session Idle: 8 hours

SSO Session Max: 7 days

Offline session idle: 30 days (only if you use offline tokens)

Offline session max: 60 days (only if you use offline tokens)

Why: short access tokens + refresh tokens gives good security and smooth UX.

Realm → Security defenses

Enable brute force detection (Realm Settings → Security Defenses)

Brute force detection: ON

Max login failures: 5

Wait increment: 60s

Max wait: 15m

Failure reset time: 12h

2) Clients overview

You’ll create 4 clients:

web (public, PKCE)

mobile (public, PKCE)

admin (public, PKCE)

api (confidential) — used for audience/validation + service-to-service if needed

3) Client: web (PKCE, public)
Client → Create

Client ID: web

Client type: OpenID Connect

Client authentication: OFF (public client)

Standard flow: ON

Direct access grants: OFF (don’t use password grant)

Implicit flow: OFF

Client → Settings (important toggles)

Proof Key for Code Exchange Code Challenge Method: S256

PKCE Required: ON (in newer Keycloak versions, “PKCE Required” toggle may exist; if so enable it)

Valid Redirect URIs:

http://localhost:3000/*

Valid Post Logout Redirect URIs:

http://localhost:3000/*

Web Origins:

http://localhost:3000

(or + in dev, but prefer explicit origins in prod)

Client → Advanced

Access Token Signature Algorithm: RS256 (default)

Consent Required: OFF (optional)

4) Client: admin (PKCE, public)

Same as web, but with admin URL.

Client ID: admin

Client authentication: OFF

Standard flow: ON

PKCE: S256 + required

Valid Redirect URIs:

http://localhost:3001/*

Valid Post Logout Redirect URIs:

http://localhost:3001/*

Web Origins:

http://localhost:3001

You’ll protect admin routes in your API by checking a realm role like platform_admin.

5) Client: mobile (PKCE, public)
Client → Create

Client ID: mobile

Client authentication: OFF (public)

Standard flow: ON

Implicit flow: OFF

Direct access grants: OFF

PKCE: S256 + required

Redirect URIs (choose based on your mobile setup)
Expo (recommended dev setup)

Expo AuthSession typically uses:

exp://127.0.0.1:19000/* (sometimes)

Or a proxy redirect like: https://auth.expo.io/@your-username/your-app-slug

So set Valid Redirect URIs to:

exp://*

https://auth.expo.io/*
(Dev convenience. In production, restrict to your real scheme.)

Native app (production-style)

Use a custom scheme:

com.yourapp://oauthredirect

Set:

Valid Redirect URIs:

com.yourapp://*

Valid Post Logout Redirect URIs:

com.yourapp://*

Web Origins: (leave empty for mobile)

Keep mobile strict in prod: only your real scheme.

6) Client: api (confidential)

This client is useful to:

make sure tokens have the right audience

allow backend-to-keycloak operations if you ever need it

support introspection (optional) / service account (optional)

Client → Create

Client ID: api

Client authentication: ON (confidential)

Standard flow: OFF (usually)

Service accounts: OFF (unless you need machine-to-machine)

Direct access grants: OFF

Client → Credentials

Copy Client secret (store in backend secrets)

API audience

You want tokens used for calling your backend to include api as an audience.

Do this via Client Scopes / Audience mapper:

Option A (simple): Add an Audience mapper to web, admin, mobile clients:

Go to Client (web) → Client Scopes / Mappers

Add mapper → Audience

Name: aud-api

Included Client Audience: api

Add to ID token: OFF

Add to access token: ON

Repeat for admin and mobile.

Option B (cleaner): Create a dedicated client scope api-audience and attach it to all frontend clients:

Realm → Client scopes → Create api-audience

Add mapper Audience with Included Client Audience = api

Then: Clients (web/admin/mobile) → Client scopes → Add api-audience as Default.

Your Nest API then validates:

signature

issuer

aud contains api

7) Token config per-client (recommended)

Keycloak token lifespans can be set at realm-level; if your version supports per-client overrides, use them. Otherwise keep realm-level.

Recommended:

Access token: 5 minutes

Refresh token: enabled by standard flow; keep SSO idle/max to control it

Refresh token rotation / reuse

In Keycloak:

Realm Settings → Tokens:

Revoke Refresh Token: ON

Refresh Token Max Reuse: 0 or 1

This makes stolen refresh tokens much harder to abuse.

8) Roles for admin access

Realm → Roles:

Create role: platform_admin

Assign it to your admin users.

Your API checks:

realm_access.roles includes platform_admin

(and optionally enforce admin client usage too)

9) CORS / Origins recap (avoid pain)

For web/admin clients:

Set Web Origins explicitly to your frontend URL.

Avoid * in production.

For API:

Your backend CORS should allow http://localhost:3000 and http://localhost:3001 in dev.

10) What your frontends should do (PKCE specifics)

Use Authorization Code Flow + PKCE:

code_challenge_method=S256

Send code_verifier on token exchange

Most libraries handle this:

Web: oidc-client-ts, react-oidc-context, or @auth0/auth0-react style patterns (but for Keycloak use OIDC libs)

Mobile: Expo AuthSession / AppAuth libraries