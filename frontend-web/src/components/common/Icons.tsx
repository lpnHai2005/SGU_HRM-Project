import type { ReactNode } from 'react'
import { LayoutDashboard, Users, Clock, CalendarDays, Wallet, ChartColumn, Shield, ClipboardList, Image as ImageIcon, ImageOff, ZoomIn, ZoomOut,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ChevronDown, Check, X, LogOut, Zap, DollarSign, Plus,
  TrendingUp, TrendingDown, FileText, Monitor, Printer, User, Building2, Search,
  ListFilter, EllipsisVertical, CircleCheck, CircleAlert, CircleX, Sun, Moon, Menu,
  Info, RefreshCw, LoaderCircle, Eye, Pencil, TriangleAlert, Bell, Palmtree,
  CircleMinus, LockKeyhole, Store, Sparkles, Download, BriefcaseBusiness, RotateCcw,
  Paperclip, Upload, MapPin } from 'lucide-react'
const glyphs = { download: Download, briefcase: BriefcaseBusiness, dashboard: LayoutDashboard, users: Users, clock: Clock, calendar: CalendarDays,
  wallet: Wallet, chart: ChartColumn, shield: Shield, chevronLeft: ChevronLeft,
  chevronRight: ChevronRight, chevronsLeft: ChevronsLeft, chevronsRight: ChevronsRight, chevronDown: ChevronDown, check: Check, x: X, close: X,
  logOut: LogOut, zap: Zap, dollar: DollarSign, plus: Plus, trendingUp: TrendingUp,
  trendingDown: TrendingDown, fileText: FileText, techzone: Monitor, printer: Printer,
  user: User, building: Building2, search: Search, filter: ListFilter, moreVertical: EllipsisVertical,
  checkCircle: CircleCheck, alertCircle: CircleAlert, xCircle: CircleX, clockOutline: Clock,
  sun: Sun, moon: Moon, menu: Menu, info: Info, refresh: RefreshCw, loader: LoaderCircle,
  eye: Eye, edit: Pencil, alertTriangle: TriangleAlert, bell: Bell, leave: Palmtree, clipboardList: ClipboardList,
  image: ImageIcon, imageOff: ImageOff, zoomIn: ZoomIn, zoomOut: ZoomOut,
  minusCircle: CircleMinus, lock: LockKeyhole, store: Store, sparkles: Sparkles, undo: RotateCcw,
  paperclip: Paperclip, upload: Upload, mapPin: MapPin }
export const Icons: Record<string, ReactNode> = Object.fromEntries(
  Object.entries(glyphs).map(([key, Glyph]) => [key, <Glyph key={key} size={20} strokeWidth={1.8} aria-hidden="true" focusable="false" />]),
)
