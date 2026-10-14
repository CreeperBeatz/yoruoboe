import { useState } from 'react'
import { api, ApiError, type Me } from '../api'
import './login.css'

/**
 * AnkiDroid's "Log in to AnkiWeb" screen: sign in to sync; the collection is downloaded
 * the first time. The app also works without an account, as AnkiDroid does.
 */
export default function Login({ server, onDone, onSkip }: { server: string; onDone: (me: Me) => void; onSkip: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api.post('/api/login', { username, password })
      onDone(await api.get<Me>('/api/me'))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="screen login">
      <div className="login-top">
        <img src="/icon-192.png" alt="" className="login-logo" />
        <h1>Anki</h1>
      </div>
      <form className="login-form" onSubmit={submit}>
        <p className="login-hint">
          {server
            ? `Log in to your sync server (${server}).`
            : 'Log in with your AnkiWeb account to sync with Anki on your other devices.'}{' '}
          Your collection is downloaded to this device the first time.
        </p>
        <label className="field">
          <span>{server ? 'Username' : 'Email'}</span>
          <input
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode={server ? 'text' : 'email'}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <div className="login-error">{error}</div>}
        <button className="btn login-btn" disabled={busy || !username || !password}>
          {busy ? 'Logging in and syncing…' : 'Log in'}
        </button>
        {busy && <div className="progress-bar" style={{ marginTop: 16 }} />}
        {!busy && (
          <button type="button" className="text-btn login-skip" onClick={onSkip}>
            Use without an account
          </button>
        )}
      </form>
    </div>
  )
}
