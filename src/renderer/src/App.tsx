import { AppShell } from './components/layout/AppShell'
import { Sidebar } from './components/layout/Sidebar'
import { TimelineView } from './components/timeline/TimelineView'
import { UpdateBanner } from './components/update/UpdateBanner'

function App(): JSX.Element {
  return (
    <>
      <UpdateBanner />
      <AppShell sidebar={<Sidebar />}>
        <TimelineView />
      </AppShell>
    </>
  )
}

export default App
