import { PayrollRegulationDialog } from './PayrollRegulationDialog'

export function AttendanceRegulationDialog({ onClose }: { onClose: () => void }) {
  return <PayrollRegulationDialog onClose={onClose} initialTab="attendance" />
}
