/**
 * The study screen: the next card, its answer side, and answering it. Port of
 * server/routes/review.py.
 *
 * As desktop's reviewer does, the scheduling states of the card on screen are kept
 * between calls; the deck's custom scheduling JavaScript may change them (through
 * setSchedulingStates, see ../pages.ts) before the card is answered.
 */

import type { Card } from '../../engine/generated/anki/cards_pb'
import { CardAnswer_Rating, type SchedulingContext, type SchedulingStates } from '../../engine/generated/anki/scheduler_pb'
import { be, currentDeckId, onCrash, currentDeckOf, deckConfigForDeck, deckName, getCard, getConfig, getNote, hasTag, noteCardIds, undoInfo, userFlag } from '../col'
import { get, HttpError, num, post } from '../http'
import {
  bodyClass,
  deckConfForCard,
  hidePlayButtons,
  prepare,
  renderCard,
  type Rendered,
  type TypeAnswer,
  typeAnswerAnswer,
  typeAnswerQuestion,
} from '../render'

const QUEUE_NAMES = ['new', 'learn', 'review'] as const

interface Session {
  key: string
  card: Card
  states: SchedulingStates
  context: SchedulingContext | undefined
  rendered: Rendered
  typeAnswer: TypeAnswer
  shownAt: number
}

let session: Session | null = null
onCrash(() => (session = null))

/** Forget the card on screen: it may have changed or left the queue. */
export function resetReview() {
  session = null
}

export function reviewSession(): Session | null {
  return session
}

function newKey() {
  const b = new Uint8Array(8)
  crypto.getRandomValues(b)
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

export async function nextCard() {
  const out = await be.getQueuedCards({ fetchLimit: 2, intradayLearningOnly: false })
  if (!out.cards.length) {
    session = null
    const info = await be.congratsInfo({})
    return {
      finished: true,
      deckId: await currentDeckId(),
      congrats: {
        learnRemaining: info.learnRemaining,
        secsUntilNextLearn: info.secsUntilNextLearn,
        reviewRemaining: info.reviewRemaining,
        newRemaining: info.newRemaining,
        haveSchedBuried: info.haveSchedBuried,
        haveUserBuried: info.haveUserBuried,
        isFilteredDeck: info.isFilteredDeck,
        deckDescription: info.deckDescription,
      },
      undo: await undoInfo(),
    }
  }
  const top = out.cards[0]
  const card = top.card!
  const states = top.states!
  if (states.current) states.current.customData = card.customData

  const hide = await hidePlayButtons()
  const rendered = await renderCard(num(card.id))
  const [q, ta] = await typeAnswerQuestion(card, await prepare(rendered.question, hide))
  // The answer, without typing, so the frame can preload its images.
  const aPreload = (await be.encodeIriPaths({ val: rendered.answer })).val

  const key = session?.key ?? newKey()
  session = { key, card, states, context: top.context, rendered, typeAnswer: ta, shownAt: Date.now() }

  const note = await getNote(num(card.noteId))
  const siblings = (await noteCardIds(num(card.noteId))).length > 1
  const did = currentDeckOf(card)
  const conf = await deckConfigForDeck(did)
  return {
    finished: false,
    key,
    card: {
      id: num(card.id),
      noteId: num(card.noteId),
      mod: num(card.mtimeSecs),
      ord: card.templateIdx,
      deckId: did,
      deckName: await deckName(did),
      queue: QUEUE_NAMES[top.queue] ?? 'new',
      flag: userFlag(card),
      marked: hasTag(note.tags, 'marked'),
      hasSiblings: siblings,
      bodyClass: bodyClass(card),
      question: q,
      answerPreload: aPreload,
      questionAv: rendered.questionAv,
      hasTypeAnswer: ta.found && Boolean(ta.correct),
      timeLimitSecs: Number(conf.maxTaken ?? 60),
    },
    nextCardId: out.cards.length > 1 ? num(out.cards[1].card!.id) : null,
    counts: { new: out.newCount, learn: out.learningCount, review: out.reviewCount },
    deckConf: await deckConfForCard(card),
    showRemaining: Boolean(await getConfig('dueCounts', true)),
    showIntervals: Boolean(await getConfig('estTimes', true)),
    customScheduling: (await getConfig<string>('cardStateCustomizer', '')) || '',
    undo: await undoInfo(),
  }
}

get('/api/review/next', () => nextCard())

post('/api/review/answer-side', async ({ body }) => {
  const s = session
  if (!s || num(s.card.id) !== Number(body.cardId)) throw new HttpError(409, 'This card is no longer being studied.')
  const a = await typeAnswerAnswer(await prepare(s.rendered.answer, await hidePlayButtons()), s.typeAnswer, String(body.typed ?? ''))
  const labels = (await be.describeNextStates(s.states)).vals
  return { answer: a, answerAv: s.rendered.answerAv, questionAv: s.rendered.questionAv, labels }
})

const RATINGS = [CardAnswer_Rating.AGAIN, CardAnswer_Rating.HARD, CardAnswer_Rating.GOOD, CardAnswer_Rating.EASY]

post('/api/review/answer', async ({ body }) => {
  const ease = Number(body.ease)
  if (![1, 2, 3, 4].includes(ease)) throw new HttpError(400, 'ease must be 1-4')
  const s = session
  if (!s || num(s.card.id) !== Number(body.cardId)) throw new HttpError(409, 'This card is no longer being studied.')
  const st = s.states
  const newState = [st.again, st.hard, st.good, st.easy][ease - 1]!
  const millis = body.millis != null ? Math.max(0, Number(body.millis)) : Date.now() - s.shownAt
  try {
    await be.answerCard({
      cardId: s.card.id,
      currentState: st.current,
      newState,
      rating: RATINGS[ease - 1],
      answeredAtMillis: BigInt(Date.now()),
      millisecondsTaken: Math.round(millis),
    })
  } catch (err) {
    // Changed meanwhile (a sync): show what is due now instead.
    session = null
    return { error: err instanceof Error ? err.message : String(err), next: await nextCard() }
  }
  const leech = (await be.stateIsLeech(newState)).val
  let leechSuspended = false
  if (leech) leechSuspended = (await getCard(num(s.card.id))).queue === -1
  return { leech, leechSuspended, next: await nextCard() }
})

post('/api/review/time-box', async () => ({ limitSecs: Number(await getConfig('timeLim', 0)) }))
