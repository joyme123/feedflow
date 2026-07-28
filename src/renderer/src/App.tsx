import { AppShell } from './components/layout/AppShell'
import { Sidebar } from './components/layout/Sidebar'
import { TimelineView } from './components/timeline/TimelineView'

function App(): JSX.Element {
  return (
    <AppShell sidebar={<Sidebar />}>
      <TimelineView />
    </AppShell>
  )
}

export default App
