const AUTHORS = [
  { name: 'Alice Chen', avatar: '' },
  { name: 'Bob Wang', avatar: '' },
  { name: 'Diana Lopez', avatar: '' },
  { name: 'Ethan Zhang', avatar: '' },
  { name: 'Fiona Park', avatar: '' }
]

const TOPICS = {
  tech: [
    'Just shipped a new React component library. Zero-config, tree-shakeable, 2KB gzipped.',
    'Rust runtime for WebAssembly just hit 1.0. This changes the edge computing landscape.',
    'PostgreSQL 17 is out. Native incremental backup is a game changer for large databases.',
    'TIL: you can use CSS container queries to build truly reusable responsive components.',
    'Benchmarking Bun vs. Node 22 for an API server. Bun is 2.3x faster on our workload.',
    'Open source contribution tip: look for "good first issue" labels on repos you actually use.'
  ],
  design: [
    'New color palette for our design system. Moving from 12 stops to 6 with proper contrast ratios.',
    'The difference between a good UI and a great UI is often just 4px of padding.',
    'Prototyped a new onboarding flow. User activation went from 23% to 41% in the first test.',
    'Typography pairing: Inter for UI, Source Serif for long-form reading. Works beautifully.',
    'Design critique: the hamburger menu is not the enemy. Poor information architecture is.'
  ],
  news: [
    'Breaking: Largest solar farm in Southeast Asia goes online, powering 2 million homes.',
    'NASA confirms water ice in lunar south pole craters. Artemis landing site candidates updated.',
    'EU Parliament passes Right-to-Repair legislation. Phones must have user-replaceable batteries by 2028.',
    'Global developer survey: TypeScript overtakes JavaScript as most-used language for the first time.'
  ],
  random: [
    'Made sourdough bread for the first time. The starter is alive and it has opinions.',
    'Running a half marathon next month. Training plan is painful but the playlist is excellent.',
    'Visited the new library downtown. The architecture alone is worth the trip.',
    'Unpopular opinion: dark mode is overrated. Light mode with proper brightness is easier on my eyes.',
    'Book recommendation: "The Design of Everyday Things" -- still relevant after 35 years.'
  ]
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function generateItem(config, index) {
  const topics = Array.isArray(config.topics) ? config.topics : ['random']
  const chosenTopic = pick(topics)
  const templates = TOPICS[chosenTopic] || TOPICS.random
  const author = pick(AUTHORS)
  const hoursAgo = Math.floor(Math.random() * 72)

  return {
    externalId: `mock-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 9)}`,
    author: {
      name: author.name,
      avatarUrl: '',
      profileUrl: ''
    },
    content: {
      text: pick(templates)
    },
    mediaUrls: config.includeImages
      ? [`https://picsum.photos/seed/${Date.now()}-${index}/600/400`]
      : [],
    permalink: '',
    publishedAt: new Date(Date.now() - hoursAgo * 3600000).toISOString(),
    metadata: {
      topic: chosenTopic,
      index
    }
  }
}

const meta = {
  id: 'feedflow-plugin-mock',
  name: 'Mock Source',
  version: '1.0.0',
  description: 'A simulated information source for FeedFlow development and testing',
  author: 'FeedFlow',
  color: '#6C5CE7',
  provider: 'mock',
  providerName: 'Mock'
}

const configSchema = [
  {
    key: 'postCount',
    label: 'Posts per refresh',
    type: 'number',
    default: 10,
    min: 1,
    max: 50,
    helpText: 'How many fake posts to generate on each refresh'
  },
  {
    key: 'topics',
    label: 'Topics',
    type: 'select',
    default: 'random',
    options: [
      { label: 'Technology', value: 'tech' },
      { label: 'Design', value: 'design' },
      { label: 'News', value: 'news' },
      { label: 'Random', value: 'random' }
    ],
    helpText: 'Content category for generated posts'
  },
  {
    key: 'includeImages',
    label: 'Include placeholder images',
    type: 'boolean',
    default: true,
    helpText: 'Add picsum.photos placeholder images to posts'
  }
]

async function fetchItems(config, _cursor) {
  const count = config.postCount ?? 10
  const items = []

  // Simulate network delay (300-800ms)
  await new Promise((resolve) => setTimeout(resolve, 300 + Math.random() * 500))

  for (let i = 0; i < count; i++) {
    items.push(generateItem(config, i))
  }

  return {
    items,
    nextCursor: null
  }
}

const mockPlugin = {
  meta,
  configSchema,
  fetchItems
}

module.exports = { default: mockPlugin }
