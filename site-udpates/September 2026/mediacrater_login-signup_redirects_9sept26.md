# Mediacrater — Auth Redirect Change Index

## Change: Prevent authenticated users from seeing `/signup` or `/signin`

### Purpose

Make the signup and signin pages auth-aware.

- Logged-out users can see the appropriate auth form.
- Logged-in users are immediately redirected to `/dashboard`.
- The auth form must **not flash on screen** while the session check is happening.
- Use `router.replace()` so authenticated users do not return to the auth page via browser Back.

### Files changed

- `app/signup/page.tsx`
- `app/signin/page.tsx`

### File intentionally NOT changed

- `hero.tsx`

The Hero's **“Try it free”** CTA continues to point to `/signup`. The redirect logic belongs inside the auth page so every way of reaching `/signup` gets the same behavior. The current Hero CTA uses `SIGNUP_LINK` and links to `/signup`. fileciteturn2file0L8-L10 fileciteturn2file0L160-L172

---

## 1. `app/signup/page.tsx`

### Change 1 — Import Supabase client

Add this import:

```tsx
import { supabase } from "@/lib/mediacrater/supabaseClient"
```

### Change 2 — Add session-checking state

Inside the signup page component, add:

```tsx
const [checkingSession, setCheckingSession] = useState(true)
```

### Change 3 — Check the existing session before showing signup

Add this `useEffect`:

```tsx
useEffect(() => {
  let mounted = true

  supabase.auth.getSession().then(({ data: { session } }) => {
    if (session) {
      router.replace("/dashboard")
      return
    }

    if (mounted) {
      setCheckingSession(false)
    }
  })

  return () => {
    mounted = false
  }
}, [router])
```

### Change 4 — Do not render the signup page while checking

Before the component's normal page `return`, add:

```tsx
if (checkingSession) {
  return null
}
```

### Result

The flow becomes:

```text
/signup
   ↓
Check Supabase session
   ↓
Session exists → router.replace("/dashboard")
   ↓
No session → show signup form
```

There is no signup-form render while the session check is pending.

---

## 2. `app/signin/page.tsx`

### Change 1 — Reuse existing Supabase import

No new Supabase import is needed because `app/signin/page.tsx` already imports:

```tsx
import { supabase } from "@/lib/mediacrater/supabaseClient"
```

### Change 2 — Add session-checking state

Inside the signin page component, add:

```tsx
const [checkingSession, setCheckingSession] = useState(true)
```

### Change 3 — Check the existing session before showing signin

Add this `useEffect`:

```tsx
useEffect(() => {
  let mounted = true

  supabase.auth.getSession().then(({ data: { session } }) => {
    if (session) {
      router.replace("/dashboard")
      return
    }

    if (mounted) {
      setCheckingSession(false)
    }
  })

  return () => {
    mounted = false
  }
}, [router])
```

### Change 4 — Do not render the signin page while checking

Before the component's normal page `return`, add:

```tsx
if (checkingSession) {
  return null
}
```

### Result

The flow becomes:

```text
/signin
   ↓
Check Supabase session
   ↓
Session exists → router.replace("/dashboard")
   ↓
No session → show signin form
```

There is no signin-form render while the session check is pending.

---

## 3. Why `router.replace()` was used

Use:

```tsx
router.replace("/dashboard")
```

rather than:

```tsx
router.push("/dashboard")
```

Reason: an authenticated user who reaches `/signup` or `/signin` should not have those auth pages left in the navigation history.

Desired behavior:

```text
/signup → /dashboard
```

not:

```text
/signup → /dashboard → Back → /signup
```

---

## 4. Final behavior

| User | Visits | Behavior |
|---|---|---|
| Logged out | `/signup` | Signup form appears |
| Logged in | `/signup` | Redirects to `/dashboard` |
| Logged out | `/signin` | Signin form appears |
| Logged in | `/signin` | Redirects to `/dashboard` |
| Logged out | Hero → “Try it free” | `/signup` → signup |
| Logged in | Hero → “Try it free” | `/signup` → `/dashboard` |

### Important implementation detail

The key UX requirement is:

```tsx
if (checkingSession) {
  return null
}
```

The form is not rendered during the session check, preventing a visible signup/signin flash before the redirect.

---

## 5. Exact implementation summary

### `app/signup/page.tsx`

Added:

```tsx
import { supabase } from "@/lib/mediacrater/supabaseClient"
```

Added state:

```tsx
const [checkingSession, setCheckingSession] = useState(true)
```

Added effect:

```tsx
useEffect(() => {
  let mounted = true

  supabase.auth.getSession().then(({ data: { session } }) => {
    if (session) {
      router.replace("/dashboard")
      return
    }

    if (mounted) {
      setCheckingSession(false)
    }
  })

  return () => {
    mounted = false
  }
}, [router])
```

Added render gate:

```tsx
if (checkingSession) {
  return null
}
```

### `app/signin/page.tsx`

Added state:

```tsx
const [checkingSession, setCheckingSession] = useState(true)
```

Added effect:

```tsx
useEffect(() => {
  let mounted = true

  supabase.auth.getSession().then(({ data: { session } }) => {
    if (session) {
      router.replace("/dashboard")
      return
    }

    if (mounted) {
      setCheckingSession(false)
    }
  })

  return () => {
    mounted = false
  }
}, [router])
```

Added render gate:

```tsx
if (checkingSession) {
  return null
}
```

---

## Status

**Auth-aware signup/signin redirect — documented.**

The intended implementation is limited to `app/signup/page.tsx` and `app/signin/page.tsx`; no Hero CTA change is required.
