/**
 * The app's API, answered on this device by Anki's engine. Importing this registers
 * every route; ../api.ts sends requests here instead of to a server.
 */

import './routes/account'
import './routes/browse'
import './routes/cards'
import './routes/decks'
import './routes/notetypes'
import './routes/review'
import './routes/tools'

export { handle, HttpError } from './http'
export { ready } from './col'
