import type { Session } from '@po/shared'

/** Dados guardados no aparelho para voltar à sala depois de cair ou recarregar. */
const SESSION_KEY = 'po:session'
const NAME_KEY = 'po:name'

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* armazenamento indisponível: o jogo segue, só não reconecta sozinho */
  }
}

export const loadSession = () => read<Session>(SESSION_KEY)
export const saveSession = (s: Session | null) => write(SESSION_KEY, s)
export const loadName = () => read<string>(NAME_KEY) ?? ''
export const saveName = (name: string) => write(NAME_KEY, name)
