import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type ReactNode,
} from 'react'
import './App.css'

const SCHEMA_VERSION = 1
const MAX_GROUPS = 20
const MAX_MEMBERS = 4
const GROUP_PALETTE = [
  { solid: '#59d98e', soft: 'rgba(89, 217, 142, 0.18)', line: 'rgba(89, 217, 142, 0.45)' },
  { solid: '#ff8a5b', soft: 'rgba(255, 138, 91, 0.18)', line: 'rgba(255, 138, 91, 0.45)' },
  { solid: '#63c6ff', soft: 'rgba(99, 198, 255, 0.18)', line: 'rgba(99, 198, 255, 0.45)' },
  { solid: '#f4d35e', soft: 'rgba(244, 211, 94, 0.18)', line: 'rgba(244, 211, 94, 0.45)' },
  { solid: '#d58cff', soft: 'rgba(213, 140, 255, 0.18)', line: 'rgba(213, 140, 255, 0.45)' },
  { solid: '#ff6fa8', soft: 'rgba(255, 111, 168, 0.18)', line: 'rgba(255, 111, 168, 0.45)' },
]

type TournamentStatus = 'draft' | 'active' | 'finished'

type Member = {
  id: string
  name: string
}

type Group = {
  id: string
  name: string
  members: Member[]
}

type PlacementEntry = {
  groupId: string
  placement: number
}

type KillEntry = {
  groupId: string
  memberId: string
  kills: number
}

type MatchEntry = {
  id: string
  matchNumber: number
  placements: PlacementEntry[]
  kills: KillEntry[]
}

type TournamentState = {
  schemaVersion: number
  status: TournamentStatus
  groupSetupStarted: boolean
  currentCardIndex: number
  revealedLeaderboardCount: number
  groups: Group[]
  matches: MatchEntry[]
  createdAt: string
  updatedAt: string
}

type DerivedLeaderboardRow = {
  rank: number
  groupId: string
  groupName: string
  totalPoints: number
  totalKills: number
}

type MatchBreakdown = {
  placement: number
  placementPoints: number
  totalKills: number
  totalPoints: number
}

type FlashMessage = {
  tone: 'success' | 'error' | 'info'
  text: string
}

type CardDescriptor =
  | { key: 'welcome'; type: 'welcome' }
  | { key: 'group-setup'; type: 'group-setup' }
  | { key: `match-${number}`; type: 'match-entry'; matchNumber: number }
  | { key: `leaderboard-${number}`; type: 'leaderboard'; matchNumber: number }

const emptyDraftMembers = ['']

function createId(prefix: string) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }

  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function sanitizeInteger(value: string | number) {
  const normalized = typeof value === 'number' ? value : Number.parseInt(value, 10)

  if (!Number.isFinite(normalized) || normalized < 0) {
    return 0
  }

  return Math.floor(normalized)
}

function getPlacementPoints(placement: number) {
  return placement >= 1 && placement <= 10 ? 11 - placement : 0
}

function createInitialState(): TournamentState {
  const now = new Date().toISOString()

  return {
    schemaVersion: SCHEMA_VERSION,
    status: 'draft',
    groupSetupStarted: false,
    currentCardIndex: 0,
    revealedLeaderboardCount: 0,
    groups: [],
    matches: [],
    createdAt: now,
    updatedAt: now,
  }
}

function createEmptyMatch(groups: Group[], matchNumber: number): MatchEntry {
  return {
    id: createId(`match-${matchNumber}`),
    matchNumber,
    placements: groups.map((group) => ({
      groupId: group.id,
      placement: 0,
    })),
    kills: groups.flatMap((group) =>
      group.members.map((member) => ({
        groupId: group.id,
        memberId: member.id,
        kills: 0,
      })),
    ),
  }
}

function buildCards(state: TournamentState): CardDescriptor[] {
  const cards: CardDescriptor[] = [{ key: 'welcome', type: 'welcome' }]

  if (
    state.groupSetupStarted ||
    state.groups.length > 0 ||
    state.matches.length > 0 ||
    state.status !== 'draft'
  ) {
    cards.push({ key: 'group-setup', type: 'group-setup' })
  }

  state.matches.forEach((_, index) => {
    const matchNumber = index + 1

    cards.push({
      key: `match-${matchNumber}`,
      type: 'match-entry',
      matchNumber,
    })

    if (index < state.revealedLeaderboardCount) {
      cards.push({
        key: `leaderboard-${matchNumber}`,
        type: 'leaderboard',
        matchNumber,
      })
    }
  })

  return cards
}

function getMatchCardIndex(matchNumber: number) {
  return 2 + (matchNumber - 1) * 2
}

function getLeaderboardCardIndex(matchNumber: number) {
  return 3 + (matchNumber - 1) * 2
}

function getPlacementValue(match: MatchEntry, groupId: string) {
  return match.placements.find((entry) => entry.groupId === groupId)?.placement ?? 0
}

function getMemberKillValue(match: MatchEntry, groupId: string, memberId: string) {
  return (
    match.kills.find(
      (entry) => entry.groupId === groupId && entry.memberId === memberId,
    )?.kills ?? 0
  )
}

function getGroupMatchBreakdown(match: MatchEntry, group: Group): MatchBreakdown {
  const placement = getPlacementValue(match, group.id)
  const placementPoints = getPlacementPoints(placement)
  const totalKills = group.members.reduce(
    (sum, member) => sum + getMemberKillValue(match, group.id, member.id),
    0,
  )

  return {
    placement,
    placementPoints,
    totalKills,
    totalPoints: placementPoints + totalKills,
  }
}

function calculateLeaderboard(
  groups: Group[],
  matches: MatchEntry[],
): DerivedLeaderboardRow[] {
  const totals = groups.map((group) => {
    const aggregate = matches.reduce(
      (sum, match) => {
        const breakdown = getGroupMatchBreakdown(match, group)

        return {
          totalPoints: sum.totalPoints + breakdown.totalPoints,
          totalKills: sum.totalKills + breakdown.totalKills,
        }
      },
      { totalPoints: 0, totalKills: 0 },
    )

    return {
      groupId: group.id,
      groupName: group.name,
      totalPoints: aggregate.totalPoints,
      totalKills: aggregate.totalKills,
    }
  })

  return totals
    .sort((left, right) => {
      if (right.totalPoints !== left.totalPoints) {
        return right.totalPoints - left.totalPoints
      }

      if (right.totalKills !== left.totalKills) {
        return right.totalKills - left.totalKills
      }

      return left.groupName.localeCompare(right.groupName, 'tr')
    })
    .map((row, index) => ({
      rank: index + 1,
      ...row,
    }))
}

function getPlacementConflicts(match: MatchEntry) {
  const counts = new Map<number, number>()

  for (const entry of match.placements) {
    if (entry.placement <= 0) {
      continue
    }

    counts.set(entry.placement, (counts.get(entry.placement) ?? 0) + 1)
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([placement]) => placement)
    .sort((left, right) => left - right)
}

function normalizeLoadedState(raw: unknown): TournamentState {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Geçerli bir JSON dosyası seçilmedi.')
  }

  const data = raw as Partial<TournamentState>

  if (
    typeof data.schemaVersion === 'number' &&
    data.schemaVersion !== SCHEMA_VERSION
  ) {
    throw new Error(
      `Desteklenmeyen JSON şeması. Beklenen sürüm: ${SCHEMA_VERSION}.`,
    )
  }

  const rawGroups = Array.isArray(data.groups) ? data.groups : []

  const groups = rawGroups.map((rawGroup, groupIndex) => {
    if (!rawGroup || typeof rawGroup !== 'object') {
      throw new Error('Grup verisi okunamadı.')
    }

    const group = rawGroup as Partial<Group>
    const groupName = typeof group.name === 'string' ? group.name.trim() : ''

    if (!groupName) {
      throw new Error(`Grup ${groupIndex + 1} için isim eksik.`)
    }

    const rawMembers = Array.isArray(group.members) ? group.members : []

    if (rawMembers.length === 0 || rawMembers.length > MAX_MEMBERS) {
      throw new Error(`"${groupName}" grubu için üye sayısı geçersiz.`)
    }

    const members = rawMembers.map((rawMember, memberIndex) => {
      if (!rawMember || typeof rawMember !== 'object') {
        throw new Error(`"${groupName}" grubundaki üye verisi okunamadı.`)
      }

      const member = rawMember as Partial<Member>
      const memberName = typeof member.name === 'string' ? member.name.trim() : ''

      if (!memberName) {
        throw new Error(
          `"${groupName}" grubunda ${memberIndex + 1}. üye adı eksik.`,
        )
      }

      return {
        id: typeof member.id === 'string' ? member.id : createId('member'),
        name: memberName,
      }
    })

    return {
      id: typeof group.id === 'string' ? group.id : createId('group'),
      name: groupName,
      members,
    }
  })

  if (groups.length > MAX_GROUPS) {
    throw new Error(`En fazla ${MAX_GROUPS} grup yüklenebilir.`)
  }

  const rawMatches = Array.isArray(data.matches) ? data.matches : []

  const matches = rawMatches.map((rawMatch, matchIndex) => {
    const emptyMatch = createEmptyMatch(groups, matchIndex + 1)

    if (!rawMatch || typeof rawMatch !== 'object') {
      return emptyMatch
    }

    const match = rawMatch as Partial<MatchEntry>
    const placements = emptyMatch.placements.map((entry) => {
      const found = Array.isArray(match.placements)
        ? match.placements.find(
            (placement) => placement && placement.groupId === entry.groupId,
          )
        : undefined

      return {
        ...entry,
        placement: sanitizeInteger(found?.placement ?? 0),
      }
    })

    const kills = emptyMatch.kills.map((entry) => {
      const found = Array.isArray(match.kills)
        ? match.kills.find(
            (kill) =>
              kill &&
              kill.groupId === entry.groupId &&
              kill.memberId === entry.memberId,
          )
        : undefined

      return {
        ...entry,
        kills: sanitizeInteger(found?.kills ?? 0),
      }
    })

    return {
      id: typeof match.id === 'string' ? match.id : emptyMatch.id,
      matchNumber: matchIndex + 1,
      placements,
      kills,
    }
  })

  let status: TournamentStatus = 'draft'

  if (data.status === 'active' || data.status === 'finished') {
    status = data.status
  }

  const effectiveMatches =
    status === 'active' && groups.length > 0 && matches.length === 0
      ? [createEmptyMatch(groups, 1)]
      : matches

  const revealedCountBase =
    typeof data.revealedLeaderboardCount === 'number'
      ? sanitizeInteger(data.revealedLeaderboardCount)
      : status === 'finished'
        ? effectiveMatches.length
        : Math.min(effectiveMatches.length, matches.length)

  const provisionalState: TournamentState = {
    schemaVersion: SCHEMA_VERSION,
    status,
    groupSetupStarted:
      typeof data.groupSetupStarted === 'boolean'
        ? data.groupSetupStarted
        : groups.length > 0 || effectiveMatches.length > 0,
    currentCardIndex: 0,
    revealedLeaderboardCount:
      status === 'finished'
        ? effectiveMatches.length
        : clamp(revealedCountBase, 0, effectiveMatches.length),
    groups,
    matches: effectiveMatches,
    createdAt:
      typeof data.createdAt === 'string' ? data.createdAt : new Date().toISOString(),
    updatedAt:
      typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString(),
  }

  const cards = buildCards(provisionalState)
  const desiredIndex =
    typeof data.currentCardIndex === 'number'
      ? sanitizeInteger(data.currentCardIndex)
      : cards.length - 1

  return {
    ...provisionalState,
    currentCardIndex: clamp(desiredIndex, 0, Math.max(cards.length - 1, 0)),
  }
}

type CardFrameProps = {
  title: string
  eyebrow: string
  subtitle: string
  className?: string
  index: number
  totalCards: number
  canGoBack: boolean
  canGoForward: boolean
  onBack: () => void
  onForward: () => void
  children: ReactNode
}

type NumberStepperProps = {
  label: string
  value: number
  disabled?: boolean
  placeholder?: string
  align?: 'start' | 'end'
  invalid?: boolean
  onChange: (value: string) => void
  onIncrement: () => void
  onDecrement: () => void
}

function CardFrame({
  title,
  eyebrow,
  subtitle,
  className,
  index,
  totalCards,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  children,
}: CardFrameProps) {
  return (
    <article className={className ? `card ${className}` : 'card'}>
      <div className="card__topbar">
        <div>
          <p className="card__eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        <div className="card__pager">
          <button
            className="ghost-button"
            onClick={onBack}
            disabled={!canGoBack}
            type="button"
          >
            Geri
          </button>
          <span>
            {index + 1} / {totalCards}
          </span>
          <button
            className="ghost-button"
            onClick={onForward}
            disabled={!canGoForward}
            type="button"
          >
            İleri
          </button>
        </div>
      </div>
      <p className="card__subtitle">{subtitle}</p>
      {children}
    </article>
  )
}

function getGroupAccent(index: number): CSSProperties {
  const palette = GROUP_PALETTE[index % GROUP_PALETTE.length]

  return {
    '--group-accent': palette.solid,
    '--group-accent-soft': palette.soft,
    '--group-accent-line': palette.line,
  } as CSSProperties
}

function NumberStepper({
  label,
  value,
  disabled = false,
  placeholder = '0',
  align = 'start',
  invalid = false,
  onChange,
  onIncrement,
  onDecrement,
}: NumberStepperProps) {
  return (
    <div
      className={`stepper ${align === 'end' ? 'stepper--end' : ''} ${invalid ? 'stepper--invalid' : ''}`}
    >
      <span className="stepper__label">{label}</span>
      <div className="stepper__controls">
        <button
          className="stepper__button stepper__button--decrement"
          onClick={onDecrement}
          type="button"
          disabled={disabled}
          aria-label={`${label} azalt`}
        >
          -
        </button>
        <input
          className="stepper__input"
          type="number"
          min="0"
          inputMode="numeric"
          value={value || ''}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          placeholder={placeholder}
        />
        <button
          className="stepper__button stepper__button--increment"
          onClick={onIncrement}
          type="button"
          disabled={disabled}
          aria-label={`${label} artır`}
        >
          +
        </button>
      </div>
    </div>
  )
}

function App() {
  const [tournamentState, setTournamentState] = useState(createInitialState)
  const [draftGroupName, setDraftGroupName] = useState('')
  const [draftMembers, setDraftMembers] = useState<string[]>(emptyDraftMembers)
  const [flashMessage, setFlashMessage] = useState<FlashMessage | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const deckRef = useRef<HTMLDivElement | null>(null)
  const cardRefs = useRef<Array<HTMLElement | null>>([])

  const cards = useMemo(() => buildCards(tournamentState), [tournamentState])
  const leaderboardSnapshots: DerivedLeaderboardRow[][] = useMemo(
    () =>
      tournamentState.matches.map((_, index) =>
        calculateLeaderboard(
          tournamentState.groups,
          tournamentState.matches.slice(0, index + 1),
        ),
      ),
    [tournamentState.groups, tournamentState.matches],
  )
  const matchConflicts = useMemo(
    () => tournamentState.matches.map((match) => getPlacementConflicts(match)),
    [tournamentState.matches],
  )

  useEffect(() => {
    const scrollActiveCardIntoCenter = (behavior: ScrollBehavior) => {
      const deck = deckRef.current
      const activeCard = cardRefs.current[tournamentState.currentCardIndex]

      if (!deck || !activeCard) {
        return
      }

      const targetLeft =
        activeCard.offsetLeft - (deck.clientWidth - activeCard.clientWidth) / 2

      deck.scrollTo({
        left: Math.max(targetLeft, 0),
        behavior,
      })
    }

    scrollActiveCardIntoCenter('smooth')

    const handleResize = () => scrollActiveCardIntoCenter('auto')

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [cards.length, tournamentState.currentCardIndex])

  useEffect(() => {
    if (!flashMessage) {
      return
    }

    const timeout = window.setTimeout(() => setFlashMessage(null), 4000)
    return () => window.clearTimeout(timeout)
  }, [flashMessage])

  const commitTournamentState = (
    updater: (previous: TournamentState) => TournamentState,
  ) => {
    setTournamentState((previous) => {
      const next = updater(previous)
      const cardsForNext = buildCards(next)

      return {
        ...next,
        updatedAt: new Date().toISOString(),
        currentCardIndex: clamp(
          next.currentCardIndex,
          0,
          Math.max(cardsForNext.length - 1, 0),
        ),
      }
    })
  }

  const goToCard = (targetIndex: number) => {
    setTournamentState((previous) => ({
      ...previous,
      currentCardIndex: clamp(
        targetIndex,
        0,
        Math.max(buildCards(previous).length - 1, 0),
      ),
    }))
  }

  const openGroupSetup = () => {
    commitTournamentState((previous) => ({
      ...previous,
      groupSetupStarted: true,
      currentCardIndex: 1,
    }))
  }

  const resetDraftForm = () => {
    setDraftGroupName('')
    setDraftMembers(emptyDraftMembers)
  }

  const handleDraftMemberChange = (index: number, value: string) => {
    setDraftMembers((previous) =>
      previous.map((member, memberIndex) =>
        memberIndex === index ? value : member,
      ),
    )
  }

  const addDraftMemberField = () => {
    setDraftMembers((previous) =>
      previous.length >= MAX_MEMBERS ? previous : [...previous, ''],
    )
  }

  const removeDraftMemberField = (index: number) => {
    setDraftMembers((previous) =>
      previous.length === 1
        ? previous
        : previous.filter((_, memberIndex) => memberIndex !== index),
    )
  }

  const createGroup = () => {
    const groupName = draftGroupName.trim()
    const members = draftMembers.map((member) => member.trim()).filter(Boolean)

    if (!groupName) {
      setFlashMessage({ tone: 'error', text: 'Önce grup adını girin.' })
      return
    }

    if (members.length === 0 || members.length > MAX_MEMBERS) {
      setFlashMessage({
        tone: 'error',
        text: `Her grupta 1 ile ${MAX_MEMBERS} arasında oyuncu olmalı.`,
      })
      return
    }

    if (tournamentState.groups.length >= MAX_GROUPS) {
      setFlashMessage({
        tone: 'error',
        text: `En fazla ${MAX_GROUPS} grup oluşturabilirsiniz.`,
      })
      return
    }

    const nextGroup: Group = {
      id: createId('group'),
      name: groupName,
      members: members.map((member) => ({
        id: createId('member'),
        name: member,
      })),
    }

    commitTournamentState((previous) => ({
      ...previous,
      groupSetupStarted: true,
      groups: [...previous.groups, nextGroup],
      currentCardIndex: 1,
    }))

    resetDraftForm()
    setFlashMessage({ tone: 'success', text: `"${groupName}" grubu oluşturuldu.` })
  }

  const updateGroupName = (groupId: string, name: string) => {
    commitTournamentState((previous) => ({
      ...previous,
      groups: previous.groups.map((group) =>
        group.id === groupId ? { ...group, name } : group,
      ),
    }))
  }

  const updateGroupMemberName = (
    groupId: string,
    memberId: string,
    value: string,
  ) => {
    commitTournamentState((previous) => ({
      ...previous,
      groups: previous.groups.map((group) =>
        group.id === groupId
          ? {
              ...group,
              members: group.members.map((member) =>
                member.id === memberId ? { ...member, name: value } : member,
              ),
            }
          : group,
      ),
    }))
  }

  const addMemberToGroup = (groupId: string) => {
    commitTournamentState((previous) => ({
      ...previous,
      groups: previous.groups.map((group) =>
        group.id === groupId && group.members.length < MAX_MEMBERS
          ? {
              ...group,
              members: [
                ...group.members,
                { id: createId('member'), name: '' },
              ],
            }
          : group,
      ),
    }))
  }

  const removeMemberFromGroup = (groupId: string, memberId: string) => {
    commitTournamentState((previous) => ({
      ...previous,
      groups: previous.groups.map((group) =>
        group.id === groupId && group.members.length > 1
          ? {
              ...group,
              members: group.members.filter((member) => member.id !== memberId),
            }
          : group,
      ),
    }))
  }

  const deleteGroup = (groupId: string) => {
    commitTournamentState((previous) => ({
      ...previous,
      groups: previous.groups.filter((group) => group.id !== groupId),
    }))
  }

  const validateGroupsBeforeStart = () => {
    if (tournamentState.groups.length === 0) {
      return 'Turnuvayı başlatmak için en az bir grup oluşturun.'
    }

    for (const group of tournamentState.groups) {
      if (!group.name.trim()) {
        return 'Tüm grupların adı doldurulmalı.'
      }

      if (group.members.length === 0 || group.members.length > MAX_MEMBERS) {
        return `${group.name || 'Bir grup'} için oyuncu sayısı geçersiz.`
      }

      if (group.members.some((member) => !member.name.trim())) {
        return `${group.name || 'Bir grup'} içindeki tüm oyuncu adlarını doldurun.`
      }
    }

    return null
  }

  const startTournament = () => {
    const validationError = validateGroupsBeforeStart()

    if (validationError) {
      setFlashMessage({ tone: 'error', text: validationError })
      return
    }

    commitTournamentState((previous) => ({
      ...previous,
      status: 'active',
      groupSetupStarted: true,
      matches:
        previous.matches.length > 0
          ? previous.matches
          : [createEmptyMatch(previous.groups, 1)],
      currentCardIndex: getMatchCardIndex(1),
    }))
  }

  const updateMatchPlacement = (
    matchNumber: number,
    groupId: string,
    value: string,
  ) => {
    const placement = sanitizeInteger(value)

    commitTournamentState((previous) => ({
      ...previous,
      matches: previous.matches.map((match, index) =>
        index === matchNumber - 1
          ? {
              ...match,
              placements: match.placements.map((entry) =>
                entry.groupId === groupId ? { ...entry, placement } : entry,
              ),
            }
          : match,
      ),
    }))
  }

  const updateMatchKill = (
    matchNumber: number,
    groupId: string,
    memberId: string,
    value: string,
  ) => {
    const kills = sanitizeInteger(value)

    commitTournamentState((previous) => ({
      ...previous,
      matches: previous.matches.map((match, index) =>
        index === matchNumber - 1
          ? {
              ...match,
              kills: match.kills.map((entry) =>
                entry.groupId === groupId && entry.memberId === memberId
                  ? { ...entry, kills }
                  : entry,
              ),
            }
          : match,
      ),
    }))
  }

  const nudgeMatchPlacement = (
    matchNumber: number,
    groupId: string,
    delta: number,
  ) => {
    commitTournamentState((previous) => ({
      ...previous,
      matches: previous.matches.map((match, index) =>
        index === matchNumber - 1
          ? {
              ...match,
              placements: match.placements.map((entry) =>
                entry.groupId === groupId
                  ? { ...entry, placement: Math.max(entry.placement + delta, 0) }
                  : entry,
              ),
            }
          : match,
      ),
    }))
  }

  const nudgeMatchKill = (
    matchNumber: number,
    groupId: string,
    memberId: string,
    delta: number,
  ) => {
    commitTournamentState((previous) => ({
      ...previous,
      matches: previous.matches.map((match, index) =>
        index === matchNumber - 1
          ? {
              ...match,
              kills: match.kills.map((entry) =>
                entry.groupId === groupId && entry.memberId === memberId
                  ? { ...entry, kills: Math.max(entry.kills + delta, 0) }
                  : entry,
              ),
            }
          : match,
      ),
    }))
  }

  const revealLeaderboard = (matchNumber: number) => {
    const match = tournamentState.matches[matchNumber - 1]
    const hasMissingPlacements = tournamentState.groups.some(
      (group) => getPlacementValue(match, group.id) <= 0,
    )

    if (hasMissingPlacements) {
      setFlashMessage({
        tone: 'error',
        text: 'Liderlik tablosuna geçmeden önce tüm gruplara sıralama girin.',
      })
      return
    }

    if ((matchConflicts[matchNumber - 1] ?? []).length > 0) {
      setFlashMessage({
        tone: 'error',
        text: 'Aynı maçta aynı sıralama birden fazla gruba verilemez.',
      })
      return
    }

    commitTournamentState((previous) => ({
      ...previous,
      revealedLeaderboardCount: Math.max(
        previous.revealedLeaderboardCount,
        matchNumber,
      ),
      currentCardIndex: getLeaderboardCardIndex(matchNumber),
    }))
  }

  const goToNextMatch = (fromMatchNumber: number) => {
    commitTournamentState((previous) => {
      if (previous.matches.length > fromMatchNumber) {
        return {
          ...previous,
          currentCardIndex: getMatchCardIndex(fromMatchNumber + 1),
        }
      }

      return {
        ...previous,
        matches: [
          ...previous.matches,
          createEmptyMatch(previous.groups, previous.matches.length + 1),
        ],
        currentCardIndex: getMatchCardIndex(previous.matches.length + 1),
      }
    })
  }

  const finishTournament = (matchNumber: number) => {
    commitTournamentState((previous) => ({
      ...previous,
      status: 'finished',
      revealedLeaderboardCount: Math.max(
        previous.revealedLeaderboardCount,
        matchNumber,
      ),
      currentCardIndex: getLeaderboardCardIndex(matchNumber),
    }))

    setFlashMessage({
      tone: 'success',
      text: 'Turnuva tamamlandı. Kartlar artık salt okunur.',
    })
  }

  const saveTournament = () => {
    const snapshot: TournamentState = {
      ...tournamentState,
      schemaVersion: SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
    }
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const timestamp = new Date().toISOString().slice(0, 19).replaceAll(':', '-')

    link.href = url
    link.download = `pubg-turnuva-${timestamp}.json`
    link.click()
    URL.revokeObjectURL(url)

    setFlashMessage({
      tone: 'success',
      text: 'Turnuva verileri JSON olarak indirildi.',
    })
  }

  const handleJsonUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    try {
      const content = await file.text()
      const parsed = JSON.parse(content)
      const loadedState = normalizeLoadedState(parsed)

      setTournamentState(loadedState)
      resetDraftForm()
      setFlashMessage({
        tone: 'success',
        text: `"${file.name}" yüklendi. Turnuva kaldığı yerden açıldı.`,
      })
    } catch (error) {
      setFlashMessage({
        tone: 'error',
        text:
          error instanceof Error
            ? error.message
            : 'JSON yüklenirken beklenmeyen bir hata oluştu.',
      })
    } finally {
      event.target.value = ''
    }
  }

  const currentStatusLabel =
    tournamentState.status === 'draft'
      ? 'Kurulum'
      : tournamentState.status === 'active'
        ? 'Devam Ediyor'
        : 'Tamamlandı'

  const playedMatchCount = tournamentState.revealedLeaderboardCount
  const latestVisibleLeaderboard = tournamentState.revealedLeaderboardCount
  const visibleMatchCount =
    tournamentState.status === 'draft'
      ? 0
      : Math.max(tournamentState.matches.length, playedMatchCount)
  const statusBoxClassName =
    tournamentState.status === 'active'
      ? 'status-box status-box--live'
      : 'status-box'

  return (
    <div className="app-shell">
      <header className="top-strip">
        <h1>PUBG Turnuvası</h1>
        <div className="top-strip__meta">
          <div className={statusBoxClassName}>
            <span>Durum</span>
            <strong>{currentStatusLabel}</strong>
          </div>
          <div className="status-box">
            <span>Maç</span>
            <strong>{visibleMatchCount}</strong>
          </div>
        </div>
      </header>

      {flashMessage && (
        <div className={`flash-message flash-message--${flashMessage.tone}`}>
          {flashMessage.text}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json"
        hidden
        onChange={handleJsonUpload}
      />

      <section className="deck-shell">
        <div ref={deckRef} className="deck" aria-label="Turnuva kartları">
          {cards.map((card, index) => {
            const canGoBack = index > 0
            const canGoForward = index < cards.length - 1
            const distanceFromActive = Math.abs(
              index - tournamentState.currentCardIndex,
            )
            const slotClassName =
              distanceFromActive === 0
                ? 'card-slot card-slot--active'
                : distanceFromActive === 1
                  ? 'card-slot card-slot--adjacent'
                  : 'card-slot card-slot--distant'

            const navigationProps = {
              index,
              totalCards: cards.length,
              canGoBack,
              canGoForward,
              onBack: () => goToCard(index - 1),
              onForward: () => goToCard(index + 1),
            }

            if (card.type === 'welcome') {
              return (
                <section
                  key={card.key}
                  ref={(node) => {
                    cardRefs.current[index] = node
                  }}
                  className={slotClassName}
                >
                  <CardFrame
                    eyebrow="Başlangıç"
                    title="Turnuvayı başlat veya kayıtlı veriyi yükle"
                    subtitle="Akış soldan sağa yeni kartlar üretir. Geriye dönüp düzenleme yaptığınızda sonraki kartlar otomatik güncellenir."
                    className="card--welcome"
                    {...navigationProps}
                  >
                    <div className="welcome-actions">
                      <button className="primary-button" onClick={openGroupSetup} type="button">
                        Grupları Gir
                      </button>
                      <button
                        className="secondary-button"
                        onClick={() => fileInputRef.current?.click()}
                        type="button"
                      >
                        Veri Yükle
                      </button>
                    </div>
                  </CardFrame>
                </section>
              )
            }

            if (card.type === 'group-setup') {
              const groupsLocked = tournamentState.status !== 'draft'

              return (
                <section
                  key={card.key}
                  ref={(node) => {
                    cardRefs.current[index] = node
                  }}
                  className={slotClassName}
                >
                  <CardFrame
                    eyebrow="Grup Kurulumu"
                    title="Grupları oluştur ve başlangıç listesini hazırlamaya başla"
                    subtitle="Turnuva başladıktan sonra grup yapısı kilitlenir. Başlamadan önce isimleri ve oyuncuları serbestçe düzenleyebilirsiniz."
                    {...navigationProps}
                  >
                    <div className="panel-grid">
                      <section className="panel">
                        <div className="panel__header">
                          <div>
                            <h3>Yeni Grup</h3>
                            <p>Grup adı ve oyuncuları sırayla girin.</p>
                          </div>
                          <span className="badge">
                            {tournamentState.groups.length} / {MAX_GROUPS}
                          </span>
                        </div>

                        <label className="field">
                          <span>Grup Adı</span>
                          <input
                            type="text"
                            value={draftGroupName}
                            onChange={(event) => setDraftGroupName(event.target.value)}
                            disabled={groupsLocked}
                            placeholder="Ör: Şimşekler"
                          />
                        </label>

                        <div className="field-stack">
                          <span className="field-stack__label">Oyuncular</span>
                          {draftMembers.map((member, memberIndex) => (
                            <div className="inline-field" key={`draft-member-${memberIndex}`}>
                              <input
                                type="text"
                                value={member}
                                onChange={(event) =>
                                  handleDraftMemberChange(memberIndex, event.target.value)
                                }
                                disabled={groupsLocked}
                                placeholder={`${memberIndex + 1}. oyuncu`}
                              />
                              <button
                                className="ghost-button"
                                onClick={() => removeDraftMemberField(memberIndex)}
                                type="button"
                                disabled={groupsLocked || draftMembers.length === 1}
                              >
                                Sil
                              </button>
                            </div>
                          ))}
                        </div>

                        <div className="button-row">
                          <button
                            className="secondary-button"
                            onClick={addDraftMemberField}
                            type="button"
                            disabled={groupsLocked || draftMembers.length >= MAX_MEMBERS}
                          >
                            Oyuncu Ekle
                          </button>
                          <button
                            className="primary-button"
                            onClick={createGroup}
                            type="button"
                            disabled={groupsLocked}
                          >
                            Grubu Oluştur
                          </button>
                        </div>
                      </section>

                      <section className="panel">
                        <div className="panel__header">
                          <div>
                            <h3>Mevcut Gruplar</h3>
                            <p>
                              {groupsLocked
                                ? 'Turnuva başladı; grup yapısı artık düzenlenemez.'
                                : 'Turnuvayı başlatmadan önce tüm alanları kontrol edin.'}
                            </p>
                          </div>
                        </div>

                        {tournamentState.groups.length === 0 ? (
                          <div className="empty-state">
                            Henüz grup eklenmedi. Soldaki formdan ilk grubu oluşturun.
                          </div>
                        ) : (
                          <div className="group-list">
                            {tournamentState.groups.map((group, groupIndex) => (
                              <div
                                className="group-card"
                                key={group.id}
                                style={getGroupAccent(groupIndex)}
                              >
                                <div className="group-card__header">
                                  <label className="field field--compact">
                                    <span>Grup Adı</span>
                                    <input
                                      type="text"
                                      value={group.name}
                                      onChange={(event) =>
                                        updateGroupName(group.id, event.target.value)
                                      }
                                      disabled={groupsLocked}
                                    />
                                  </label>
                                  <button
                                    className="ghost-button ghost-button--danger"
                                    onClick={() => deleteGroup(group.id)}
                                    type="button"
                                    disabled={groupsLocked}
                                  >
                                    Grubu Sil
                                  </button>
                                </div>

                                <div className="member-grid">
                                  {group.members.map((member) => (
                                    <div className="inline-field" key={member.id}>
                                      <input
                                        type="text"
                                        value={member.name}
                                        onChange={(event) =>
                                          updateGroupMemberName(
                                            group.id,
                                            member.id,
                                            event.target.value,
                                          )
                                        }
                                        disabled={groupsLocked}
                                        placeholder="Oyuncu adı"
                                      />
                                      <button
                                        className="ghost-button"
                                        onClick={() =>
                                          removeMemberFromGroup(group.id, member.id)
                                        }
                                        type="button"
                                        disabled={groupsLocked || group.members.length === 1}
                                      >
                                        Sil
                                      </button>
                                    </div>
                                  ))}
                                </div>

                                <button
                                  className="secondary-button secondary-button--small"
                                  onClick={() => addMemberToGroup(group.id)}
                                  type="button"
                                  disabled={groupsLocked || group.members.length >= MAX_MEMBERS}
                                >
                                  Oyuncu Ekle
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </section>
                    </div>

                    <div className="card-actions">
                      <button
                        className="primary-button"
                        onClick={startTournament}
                        type="button"
                        disabled={groupsLocked || tournamentState.groups.length === 0}
                      >
                        Turnuvaya Başla
                      </button>
                    </div>
                  </CardFrame>
                </section>
              )
            }

            if (card.type === 'match-entry') {
              const match = tournamentState.matches[card.matchNumber - 1]
              const conflicts = matchConflicts[card.matchNumber - 1] ?? []
              const readOnly = tournamentState.status === 'finished'
              const missingPlacementGroups = tournamentState.groups
                .filter((group) => getPlacementValue(match, group.id) <= 0)
                .map((group) => group.name)

              return (
                <section
                  key={card.key}
                  ref={(node) => {
                    cardRefs.current[index] = node
                  }}
                  className={slotClassName}
                >
                  <CardFrame
                    eyebrow={`Maç ${card.matchNumber}`}
                    title={`${card.matchNumber}. maç sonuçlarını gir`}
                    subtitle="Her grup için sıralama zorunludur. İlk 10 sıra puan getirir ve aynı derece birden fazla grupta kullanılamaz."
                    {...navigationProps}
                  >
                    {conflicts.length > 0 && (
                      <div className="inline-alert inline-alert--error">
                        Çakışan sıralamalar: {conflicts.join(', ')}. Aynı dereceyi birden
                        fazla gruba vermeden liderlik kartına geçemezsiniz.
                      </div>
                    )}

                    <div className="match-groups">
                      {tournamentState.groups.map((group, groupIndex) => {
                        const breakdown = getGroupMatchBreakdown(match, group)
                        const groupAccent = getGroupAccent(groupIndex)

                        return (
                          <section className="team-panel" key={group.id} style={groupAccent}>
                            <div className="score-row score-row--header">
                              <div className="score-row__group">
                                <strong>{group.name}</strong>
                                <div className="score-row__meta">
                                  <span className="metric metric--total">
                                    Toplam Puan: <strong>{breakdown.totalPoints}</strong>
                                  </span>
                                  <span className="metric metric--kill">
                                    Kill: <strong>{breakdown.totalKills}</strong>
                                  </span>
                                </div>
                              </div>

                              <NumberStepper
                                label="Sıralama:"
                                value={getPlacementValue(match, group.id)}
                                onChange={(value) =>
                                  updateMatchPlacement(card.matchNumber, group.id, value)
                                }
                                onIncrement={() =>
                                  nudgeMatchPlacement(card.matchNumber, group.id, 1)
                                }
                                onDecrement={() =>
                                  nudgeMatchPlacement(card.matchNumber, group.id, -1)
                                }
                                disabled={readOnly}
                                align="end"
                                invalid={!readOnly && getPlacementValue(match, group.id) <= 0}
                              />
                            </div>

                            {group.members.map((member) => (
                              <div className="score-row" key={member.id}>
                                <span className="score-row__name">{member.name}</span>
                                <NumberStepper
                                  label="Kill:"
                                  value={getMemberKillValue(match, group.id, member.id)}
                                  onChange={(value) =>
                                    updateMatchKill(
                                      card.matchNumber,
                                      group.id,
                                      member.id,
                                      value,
                                    )
                                  }
                                  onIncrement={() =>
                                    nudgeMatchKill(card.matchNumber, group.id, member.id, 1)
                                  }
                                  onDecrement={() =>
                                    nudgeMatchKill(card.matchNumber, group.id, member.id, -1)
                                  }
                                  disabled={readOnly}
                                  align="start"
                                />
                              </div>
                            ))}
                          </section>
                        )
                      })}
                    </div>

                    <div className="card-actions">
                      <button
                        className="primary-button"
                        onClick={() => revealLeaderboard(card.matchNumber)}
                        type="button"
                        disabled={
                          readOnly ||
                          conflicts.length > 0 ||
                          missingPlacementGroups.length > 0
                        }
                      >
                        Liderlik Tablosu
                      </button>
                    </div>
                  </CardFrame>
                </section>
              )
            }

            const leaderboardRows = leaderboardSnapshots[card.matchNumber - 1] ?? []
            const isLatestLeaderboard = latestVisibleLeaderboard === card.matchNumber
            const hasNextExistingMatch = tournamentState.matches.length > card.matchNumber
            const canFinish =
              tournamentState.status === 'active' &&
              isLatestLeaderboard &&
              !hasNextExistingMatch

            return (
              <section
                key={card.key}
                ref={(node) => {
                  cardRefs.current[index] = node
                }}
                className={slotClassName}
              >
                <CardFrame
                  eyebrow={`Liderlik ${card.matchNumber}`}
                  title={`${card.matchNumber}. maç sonrası genel tablo`}
                  subtitle="Toplam puanlar tüm önceki maçların birikimli sonucudur. Puan eşitliğinde toplam kill, sonra alfabetik ad sıralaması uygulanır."
                  {...navigationProps}
                >
                  <div className="leaderboard-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Sıra</th>
                          <th>Grup</th>
                          <th>Toplam Puan</th>
                          <th>Toplam Kill</th>
                        </tr>
                      </thead>
                      <tbody>
                        {leaderboardRows.map((row, rowIndex) => (
                          <tr
                            key={row.groupId}
                            className={
                              row.rank === 1
                                ? 'leaderboard-table__row leaderboard-table__row--first'
                                : row.rank === 2
                                  ? 'leaderboard-table__row leaderboard-table__row--second'
                                  : row.rank === 3
                                    ? 'leaderboard-table__row leaderboard-table__row--third'
                                    : 'leaderboard-table__row'
                            }
                            style={getGroupAccent(rowIndex)}
                          >
                            <td>{row.rank}</td>
                            <td>{row.groupName}</td>
                            <td>{row.totalPoints}</td>
                            <td>{row.totalKills}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {tournamentState.status === 'finished' && (
                    <div className="inline-alert inline-alert--info">
                      Turnuva tamamlandı. Kartlar görüntüleme modunda tutuluyor.
                    </div>
                  )}

                  {tournamentState.status === 'active' && !isLatestLeaderboard && (
                    <div className="inline-alert inline-alert--info">
                      Daha yeni maç kartları mevcut. Buradan yalnızca sonraki maça
                      atlayabilir veya mevcut veriyi kaydedebilirsiniz.
                    </div>
                  )}

                  <div className="card-actions card-actions--leaderboard">
                    <button
                      className="primary-button primary-button--danger"
                      onClick={() => finishTournament(card.matchNumber)}
                      type="button"
                      disabled={!canFinish}
                    >
                      Maçı Bitir
                    </button>
                    <button className="secondary-button" onClick={saveTournament} type="button">
                      Sonucu Kaydet
                    </button>
                    <button
                      className="primary-button primary-button--success"
                      onClick={() => goToNextMatch(card.matchNumber)}
                      type="button"
                      disabled={tournamentState.status !== 'active'}
                    >
                      {hasNextExistingMatch
                        ? `${card.matchNumber + 1}. Maça Git`
                        : 'Sonraki Maça Geç'}
                    </button>
                  </div>
                </CardFrame>
              </section>
            )
          })}
        </div>
      </section>
    </div>
  )
}

export default App
