// NEXOR ERP - HR Module Page
// Employee management, attendance, payroll, leaves

import { useState, useMemo } from 'react';
import { useBranchContext } from '@/contexts/BranchContext';
import { useAuth } from '@/hooks/useERP';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { printPayslip } from '@/lib/payslipPrinter';
import {
  Plus, Search, Edit2, Trash2, RefreshCw, Users, UserCheck,
  Calendar, DollarSign, FileText, Clock, Download, Printer,
  CheckCircle, XCircle, AlertCircle
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Employee, PayrollEntry, AttendanceRecord, LeaveRequest, DEPARTMENTS, calculatePayroll, calculateIRT, INSS_EMPLOYEE_RATE } from '@/types/hr';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format, differenceInCalendarDays } from 'date-fns';
import { pt } from 'date-fns/locale';
import { enUS } from 'date-fns/locale';

// Storage helpers
const STORAGE_KEYS = {
  employees: 'kwanzaerp_employees',
  attendance: 'kwanzaerp_attendance',
  payroll: 'kwanzaerp_payroll',
  leaves: 'kwanzaerp_leaves',
};

function getStored<T>(key: string): T[] {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
}
function setStored<T>(key: string, data: T[]) { localStorage.setItem(key, JSON.stringify(data)); }

export default function HRModule() {
  const { user } = useAuth();
  const { currentBranch } = useBranchContext();
  const { t, language } = useTranslation();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const dfLocale = language === 'pt' ? pt : enUS;
  const [activeTab, setActiveTab] = useState('funcionarios');
  const [searchTerm, setSearchTerm] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [attendanceDate, setAttendanceDate] = useState(new Date().toISOString().split('T')[0]);
  const [leaveFormOpen, setLeaveFormOpen] = useState(false);
  const [leaveForm, setLeaveForm] = useState({ employeeId: '', leaveType: 'annual' as LeaveRequest['leaveType'], startDate: '', endDate: '', reason: '' });

  // Employee form
  const [formOpen, setFormOpen] = useState(false);
  const [editEmployee, setEditEmployee] = useState<Employee | null>(null);
  const [form, setForm] = useState({
    firstName: '', lastName: '', nif: '', bi: '', gender: 'M' as 'M' | 'F',
    dateOfBirth: '', phone: '', email: '', address: '', city: 'Luanda',
    department: 'Vendas', position: '', contractType: 'permanent' as Employee['contractType'],
    startDate: '', baseSalary: 0, mealAllowance: 0, transportAllowance: 0, otherAllowances: 0,
    bankName: '', bankAccount: '',
  });

  // Payroll dialog
  const [payrollOpen, setPayrollOpen] = useState(false);
  const [payrollMonth, setPayrollMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  const refresh = () => setRefreshKey(k => k + 1);

  // Data
  const employees = useMemo(() => {
    const all = getStored<Employee>(STORAGE_KEYS.employees);
    return all.filter(e => !currentBranch || e.branchId === currentBranch.id || !e.branchId);
  }, [currentBranch, refreshKey]);

  const payrollEntries = useMemo(() => getStored<PayrollEntry>(STORAGE_KEYS.payroll), [refreshKey]);
  const leaves = useMemo(() => getStored<LeaveRequest>(STORAGE_KEYS.leaves), [refreshKey]);
  const attendance = useMemo(() => getStored<AttendanceRecord>(STORAGE_KEYS.attendance), [refreshKey]);

  const dayAttendance = useMemo(() => attendance.filter(a => a.date === attendanceDate), [attendance, attendanceDate]);

  // Attendance helpers
  const markAttendance = (empId: string, status: AttendanceRecord['status']) => {
    const emp = employees.find(e => e.id === empId);
    if (!emp) return;
    const all = getStored<AttendanceRecord>(STORAGE_KEYS.attendance);
    const existing = all.findIndex(a => a.employeeId === empId && a.date === attendanceDate);
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    if (existing >= 0) {
      if (status === 'present' && !all[existing].checkOut && all[existing].checkIn) {
        all[existing].checkOut = timeStr;
        all[existing].hoursWorked = Math.max(0, now.getHours() - parseInt(all[existing].checkIn!.split(':')[0]));
      } else {
        all[existing].status = status;
      }
    } else {
      all.push({
        id: `att_${Date.now()}`,
        employeeId: empId,
        employeeName: emp.fullName,
        date: attendanceDate,
        checkIn: status === 'present' ? timeStr : undefined,
        hoursWorked: 0, overtime: 0,
        status,
        createdAt: now.toISOString(),
      });
    }
    setStored(STORAGE_KEYS.attendance, all);
    refresh();
  };

  const getEmpAttendance = (empId: string) => dayAttendance.find(a => a.employeeId === empId);

  // Leave helpers
  const submitLeave = () => {
    const emp = employees.find(e => e.id === leaveForm.employeeId);
    if (!emp || !leaveForm.startDate || !leaveForm.endDate) { toast.error(t.hrUi.fillAllFields); return; }
    const days = differenceInCalendarDays(new Date(leaveForm.endDate), new Date(leaveForm.startDate)) + 1;
    if (days < 1) { toast.error(t.hrUi.endDateAfterStart); return; }
    const all = getStored<LeaveRequest>(STORAGE_KEYS.leaves);
    all.push({
      id: `leave_${Date.now()}`,
      employeeId: emp.id,
      employeeName: emp.fullName,
      leaveType: leaveForm.leaveType,
      startDate: leaveForm.startDate,
      endDate: leaveForm.endDate,
      days,
      reason: leaveForm.reason,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
    setStored(STORAGE_KEYS.leaves, all);
    toast.success(
      t.hrUi.leaveSubmitted
        .replace('{type}', leaveTypeLabel(leaveForm.leaveType))
        .replace('{days}', String(days))
    );
    setLeaveFormOpen(false);
    refresh();
  };

  const approveLeave = (id: string) => {
    const all = getStored<LeaveRequest>(STORAGE_KEYS.leaves);
    const idx = all.findIndex(l => l.id === id);
    if (idx >= 0) { all[idx].status = 'approved'; all[idx].approvedBy = user?.id; all[idx].approvedAt = new Date().toISOString(); }
    setStored(STORAGE_KEYS.leaves, all);
    toast.success(t.hrUi.requestApproved);
    refresh();
  };

  const rejectLeave = (id: string) => {
    const all = getStored<LeaveRequest>(STORAGE_KEYS.leaves);
    const idx = all.findIndex(l => l.id === id);
    if (idx >= 0) { all[idx].status = 'rejected'; }
    setStored(STORAGE_KEYS.leaves, all);
    toast.info(t.hrUi.requestRejected);
    refresh();
  };

  const leaveTypeLabel = (type: string) => {
    const map: Record<string, string> = {
      annual: t.hrUi.leaveTypes.annual,
      sick: t.hrUi.leaveTypes.sick,
      maternity: t.hrUi.leaveTypes.maternity,
      paternity: t.hrUi.leaveTypes.paternity,
      unpaid: t.hrUi.leaveTypes.unpaid,
      other: t.hrUi.leaveTypes.other,
    };
    return map[type] || type;
  };

  const filteredEmployees = useMemo(() => {
    if (!searchTerm) return employees;
    const q = searchTerm.toLowerCase();
    return employees.filter(e =>
      e.fullName.toLowerCase().includes(q) || e.employeeNumber.toLowerCase().includes(q) ||
      e.nif.includes(q) || e.department.toLowerCase().includes(q)
    );
  }, [employees, searchTerm]);

  const selectedEmployee = employees.find(e => e.id === selectedId);

  // Summary
  const summary = useMemo(() => ({
    total: employees.length,
    active: employees.filter(e => e.status === 'active').length,
    onLeave: employees.filter(e => e.status === 'on_leave').length,
    totalSalary: employees.filter(e => e.status === 'active').reduce((s, e) => s + e.baseSalary, 0),
  }), [employees]);

  const openNewEmployee = () => {
    setEditEmployee(null);
    setForm({ firstName: '', lastName: '', nif: '', bi: '', gender: 'M', dateOfBirth: '', phone: '', email: '', address: '', city: 'Luanda', department: 'Vendas', position: '', contractType: 'permanent', startDate: new Date().toISOString().split('T')[0], baseSalary: 0, mealAllowance: 0, transportAllowance: 0, otherAllowances: 0, bankName: '', bankAccount: '' });
    setFormOpen(true);
  };

  const openEditEmployee = (emp: Employee) => {
    setEditEmployee(emp);
    setForm({
      firstName: emp.firstName, lastName: emp.lastName, nif: emp.nif, bi: emp.bi,
      gender: emp.gender, dateOfBirth: emp.dateOfBirth, phone: emp.phone, email: emp.email || '',
      address: emp.address, city: emp.city, department: emp.department, position: emp.position,
      contractType: emp.contractType, startDate: emp.startDate, baseSalary: emp.baseSalary,
      mealAllowance: emp.mealAllowance, transportAllowance: emp.transportAllowance,
      otherAllowances: emp.otherAllowances, bankName: emp.bankName || '', bankAccount: emp.bankAccount || '',
    });
    setFormOpen(true);
  };

  const saveEmployee = () => {
    if (!form.firstName || !form.lastName) { toast.error(t.hrUi.nameRequired); return; }
    const all = getStored<Employee>(STORAGE_KEYS.employees);
    const now = new Date().toISOString();

    if (editEmployee) {
      const idx = all.findIndex(e => e.id === editEmployee.id);
      if (idx >= 0) {
        all[idx] = { ...all[idx], ...form, fullName: `${form.firstName} ${form.lastName}`, updatedAt: now };
        setStored(STORAGE_KEYS.employees, all);
        toast.success(t.hrUi.employeeUpdated);
      }
    } else {
      const seq = all.length + 1;
      const emp: Employee = {
        id: `emp_${Date.now()}`,
        employeeNumber: `EMP-${String(seq).padStart(3, '0')}`,
        ...form,
        fullName: `${form.firstName} ${form.lastName}`,
        nationality: 'Angolana',
        maritalStatus: 'single',
        branchId: currentBranch?.id || '',
        branchName: currentBranch?.name || '',
        currency: 'AOA',
        salaryFrequency: 'monthly',
        socialSecurityNumber: '',
        irtRate: 0,
        socialSecurityRate: INSS_EMPLOYEE_RATE,
        status: 'active',
        createdBy: user?.id || '',
        createdAt: now,
        updatedAt: now,
      };
      all.push(emp);
      setStored(STORAGE_KEYS.employees, all);
      toast.success(t.hrUi.employeeCreated.replace('{number}', emp.employeeNumber));
    }
    setFormOpen(false);
    refresh();
  };

  const deleteEmployee = (emp: Employee) => {
    if (!confirm(t.hrUi.deleteConfirm.replace('{name}', emp.fullName))) return;
    const all = getStored<Employee>(STORAGE_KEYS.employees).filter(e => e.id !== emp.id);
    setStored(STORAGE_KEYS.employees, all);
    setSelectedId(null);
    toast.success(t.hrUi.employeeDeleted);
    refresh();
  };

  // Generate payroll for all active employees
  const generatePayroll = () => {
    const active = employees.filter(e => e.status === 'active');
    if (active.length === 0) { toast.error(t.hrUi.noActiveEmployees); return; }

    const existing = getStored<PayrollEntry>(STORAGE_KEYS.payroll);
    const alreadyGenerated = existing.filter(p => p.period === payrollMonth);
    if (alreadyGenerated.length > 0) {
      toast.error(
        t.hrUi.payrollAlreadyExists
          .replace('{period}', payrollMonth)
          .replace('{count}', String(alreadyGenerated.length))
      );
      return;
    }

    const now = new Date().toISOString();
    const newEntries: PayrollEntry[] = active.map((emp, idx) => {
      const calc = calculatePayroll(emp);
      return {
        id: `pay_${Date.now()}_${idx}`,
        payrollNumber: `PAY-${payrollMonth.replace('-', '')}-${String(idx + 1).padStart(3, '0')}`,
        period: payrollMonth,
        ...calc,
        paymentMethod: 'bank_transfer',
        status: 'draft',
        createdBy: user?.id || '',
        createdAt: now,
      };
    });

    setStored(STORAGE_KEYS.payroll, [...existing, ...newEntries]);
    toast.success(t.hrUi.payrollGenerated.replace('{count}', String(newEntries.length)));
    setPayrollOpen(false);
    refresh();
  };

  const currentPayroll = useMemo(() => payrollEntries.filter(p => p.period === payrollMonth), [payrollEntries, payrollMonth]);
  const payrollTotals = useMemo(() => currentPayroll.reduce((a, p) => ({
    gross: a.gross + p.grossSalary, deductions: a.deductions + p.totalDeductions, net: a.net + p.netSalary,
  }), { gross: 0, deductions: 0, net: 0 }), [currentPayroll]);

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1 bg-muted/50 border-b flex-wrap">
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={openNewEmployee}>
          <Plus className="w-3 h-3" /> {t.hrUi.newEmployee}
        </Button>
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" disabled={!selectedEmployee}
          onClick={() => selectedEmployee && openEditEmployee(selectedEmployee)}>
          <Edit2 className="w-3 h-3" /> Editar
        </Button>
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1 text-destructive" disabled={!selectedEmployee}
          onClick={() => selectedEmployee && deleteEmployee(selectedEmployee)}>
          <Trash2 className="w-3 h-3" /> Eliminar
        </Button>
        <div className="w-px h-5 bg-border mx-1" />
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1 text-green-600 border-green-200 hover:bg-green-50 dark:border-green-800 dark:hover:bg-green-950/30"
          onClick={() => setPayrollOpen(true)}>
          <DollarSign className="w-3 h-3" /> {t.hrUi.generatePayroll}
        </Button>
        <Button variant="outline" size="icon" className="h-7 w-7" onClick={refresh}><RefreshCw className="w-3 h-3" /></Button>
        <div className="flex-1" />
        {/* Summary badges */}
        <div className="flex items-center gap-2 text-[10px] mr-2">
          <Badge variant="outline" className="gap-1"><Users className="w-3 h-3" /> {summary.total}</Badge>
          <Badge variant="outline" className="gap-1 text-green-600"><UserCheck className="w-3 h-3" /> {t.hrUi.activeCount.replace('{count}', String(summary.active))}</Badge>
          <Badge variant="outline" className="gap-1">{t.hrUi.salariesLabel.replace('{amount}', summary.totalSalary.toLocaleString(uiLocale))}</Badge>
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <Input placeholder={t.common.search} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="h-7 text-xs pl-7 w-40" />
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <TabsList className="w-full justify-start rounded-none border-b bg-muted/30 h-auto p-0">
          {[
            { key: 'funcionarios', labelKey: 'tabEmployees', icon: Users },
            { key: 'folha', labelKey: 'tabPayroll', icon: DollarSign },
            { key: 'presenca', labelKey: 'tabAttendance', icon: Clock },
            { key: 'ferias', labelKey: 'tabLeaves', icon: Calendar },
            { key: 'contratos', labelKey: 'tabContracts', icon: FileText },
          ].map(tab => (
            <TabsTrigger key={tab.key} value={tab.key}
              className="text-xs rounded-none border-b-2 border-transparent data-[state=active]:border-primary px-4 py-1.5 gap-1">
              <tab.icon className="w-3 h-3" /> {t.hrUi[tab.labelKey as keyof typeof t.hrUi] as string}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Employees Tab */}
        <TabsContent value="funcionarios" className="flex-1 m-0 overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/60 border-b sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2 text-left font-semibold w-20">Nº</th>
                <th className="px-3 py-2 text-left font-semibold">{t.hrUi.fullName}</th>
                <th className="px-3 py-2 text-left font-semibold w-24">{t.hrUi.nif}</th>
                <th className="px-3 py-2 text-left font-semibold w-24">{t.hrUi.department}</th>
                <th className="px-3 py-2 text-left font-semibold w-24">{t.hrUi.position}</th>
                <th className="px-3 py-2 text-left font-semibold w-20">{t.hrUi.contract}</th>
                <th className="px-3 py-2 text-right font-semibold w-28">{t.hrUi.baseSalary}</th>
                <th className="px-3 py-2 text-center font-semibold w-16">{t.common.status}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {filteredEmployees.map(emp => (
                <tr key={emp.id} className={cn("cursor-pointer hover:bg-accent/50", selectedId === emp.id && "bg-primary/15")}
                  onClick={() => setSelectedId(emp.id)} onDoubleClick={() => openEditEmployee(emp)}>
                  <td className="px-3 py-1.5 font-mono">{emp.employeeNumber}</td>
                  <td className="px-3 py-1.5 font-medium">{emp.fullName}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{emp.nif}</td>
                  <td className="px-3 py-1.5">{emp.department}</td>
                  <td className="px-3 py-1.5">{emp.position}</td>
                  <td className="px-3 py-1.5 text-muted-foreground capitalize">{emp.contractType.replace('_', ' ')}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{emp.baseSalary.toLocaleString(uiLocale)} Kz</td>
                  <td className="px-3 py-1.5 text-center">
                    <Badge variant={emp.status === 'active' ? 'default' : emp.status === 'on_leave' ? 'secondary' : 'destructive'} className="text-[9px] px-1.5 py-0">
                      {emp.status === 'active' ? t.hrUi.empStatusActive :
                        emp.status === 'on_leave' ? t.hrUi.empStatusLeave :
                        emp.status === 'terminated' ? t.hrUi.empStatusTerminated :
                        t.hrUi.empStatusSuspended}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredEmployees.length === 0 && (
            <div className="text-center py-12 text-muted-foreground text-sm">
              <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>{t.hrUi.noEmployees}</p>
            </div>
          )}
        </TabsContent>

        {/* Payroll Tab */}
        <TabsContent value="folha" className="flex-1 m-0 overflow-auto">
          <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 border-b">
            <span className="text-xs font-medium">{t.common.period}:</span>
            <Input type="month" value={payrollMonth} onChange={e => setPayrollMonth(e.target.value)} className="h-7 text-xs w-40" />
            <div className="flex-1" />
            <div className="flex gap-3 text-xs">
              <span>{t.hrUi.grossLabel} <strong className="font-mono">{payrollTotals.gross.toLocaleString(uiLocale)} Kz</strong></span>
              <span>{t.hrUi.deductionsLabel} <strong className="font-mono text-destructive">{payrollTotals.deductions.toLocaleString(uiLocale)} Kz</strong></span>
              <span>{t.hrUi.netLabel} <strong className="font-mono text-green-600">{payrollTotals.net.toLocaleString(uiLocale)} Kz</strong></span>
            </div>
          </div>
          <table className="w-full text-xs">
            <thead className="bg-muted/60 border-b sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2 text-left font-semibold w-28">{t.hrUi.payrollNumber}</th>
                <th className="px-3 py-2 text-left font-semibold w-20">{t.hrUi.employeeNo}</th>
                <th className="px-3 py-2 text-left font-semibold">{t.hrUi.employee}</th>
                <th className="px-3 py-2 text-right font-semibold w-24">{t.hrUi.baseSalaryShort}</th>
                <th className="px-3 py-2 text-right font-semibold w-24">{t.hrUi.allowances}</th>
                <th className="px-3 py-2 text-right font-semibold w-24">{t.hrUi.gross}</th>
                <th className="px-3 py-2 text-right font-semibold w-20">IRT</th>
                <th className="px-3 py-2 text-right font-semibold w-20">INSS</th>
                <th className="px-3 py-2 text-right font-semibold w-24">{t.hrUi.net}</th>
                <th className="px-3 py-2 text-center font-semibold w-16">{t.common.status}</th>
                <th className="px-3 py-2 text-center font-semibold w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {currentPayroll.map(p => {
                const emp = employees.find(e => e.id === p.employeeId);
                return (
                <tr key={p.id} className="hover:bg-accent/30">
                  <td className="px-3 py-1.5 font-mono">{p.payrollNumber}</td>
                  <td className="px-3 py-1.5 font-mono">{p.employeeNumber}</td>
                  <td className="px-3 py-1.5 font-medium">{p.employeeName}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{p.baseSalary.toLocaleString(uiLocale)}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{(p.mealAllowance + p.transportAllowance + p.otherAllowances).toLocaleString(uiLocale)}</td>
                  <td className="px-3 py-1.5 text-right font-mono font-medium">{p.grossSalary.toLocaleString(uiLocale)}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-destructive">{p.irtAmount.toLocaleString(uiLocale)}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-destructive">{p.socialSecurity.toLocaleString(uiLocale)}</td>
                  <td className="px-3 py-1.5 text-right font-mono font-bold text-green-600">{p.netSalary.toLocaleString(uiLocale)}</td>
                  <td className="px-3 py-1.5 text-center">
                    <Badge variant={p.status === 'paid' ? 'default' : 'secondary'} className="text-[9px] px-1.5 py-0">
                      {p.status === 'draft' ? t.hrUi.payrollStatusDraft : p.status === 'approved' ? t.hrUi.payrollStatusApproved : t.hrUi.payrollStatusPaid}
                    </Badge>
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => printPayslip(p, emp)}>
                      <Printer className="w-3 h-3" />
                    </Button>
                  </td>
                </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-muted/80 border-t-2 border-primary/30">
              <tr className="font-bold text-xs">
                <td className="px-3 py-2" colSpan={5}>{t.hrUi.totalEmployees.replace('{count}', String(currentPayroll.length))}</td>
                <td className="px-3 py-2 text-right font-mono">{payrollTotals.gross.toLocaleString(uiLocale)} Kz</td>
                <td className="px-3 py-2 text-right font-mono text-destructive" colSpan={2}>{payrollTotals.deductions.toLocaleString(uiLocale)} Kz</td>
                <td className="px-3 py-2 text-right font-mono text-green-600">{payrollTotals.net.toLocaleString(uiLocale)} Kz</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
          {currentPayroll.length === 0 && (
            <div className="text-center py-12 text-muted-foreground text-sm">
              <DollarSign className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>{t.hrUi.noPayrollForPeriod.replace('{period}', payrollMonth)}</p>
              <p className="text-xs mt-1">{t.hrUi.clickGeneratePayrollHint}</p>
            </div>
          )}
        </TabsContent>

        {/* Attendance Tab */}
        <TabsContent value="presenca" className="flex-1 m-0 overflow-auto">
          <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 border-b">
            <span className="text-xs font-medium">{t.common.date}:</span>
            <Input type="date" value={attendanceDate} onChange={e => setAttendanceDate(e.target.value)} className="h-7 text-xs w-40" />
            <div className="flex-1" />
            <div className="flex gap-3 text-xs">
              <Badge variant="outline" className="gap-1"><CheckCircle className="w-3 h-3 text-emerald-500" /> {t.hrUi.presentCount.replace('{count}', String(dayAttendance.filter(a => a.status === 'present').length))}</Badge>
              <Badge variant="outline" className="gap-1"><XCircle className="w-3 h-3 text-destructive" /> {t.hrUi.absentCount.replace('{count}', String(dayAttendance.filter(a => a.status === 'absent').length))}</Badge>
              <Badge variant="outline" className="gap-1"><AlertCircle className="w-3 h-3 text-orange-500" /> {t.hrUi.lateCount.replace('{count}', String(dayAttendance.filter(a => a.status === 'late').length))}</Badge>
            </div>
          </div>
          <table className="w-full text-xs">
            <thead className="bg-muted/60 border-b sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2 text-left font-semibold w-20">Nº</th>
                <th className="px-3 py-2 text-left font-semibold">{t.hrUi.employee}</th>
                <th className="px-3 py-2 text-left font-semibold w-24">{t.hrUi.department}</th>
                <th className="px-3 py-2 text-center font-semibold w-20">{t.hrUi.checkIn}</th>
                <th className="px-3 py-2 text-center font-semibold w-20">{t.hrUi.checkOut}</th>
                <th className="px-3 py-2 text-center font-semibold w-16">{t.hrUi.hours}</th>
                <th className="px-3 py-2 text-center font-semibold w-20">{t.common.status}</th>
                <th className="px-3 py-2 text-center font-semibold w-48">{t.common.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {employees.filter(e => e.status === 'active').map(emp => {
                const att = getEmpAttendance(emp.id);
                return (
                  <tr key={emp.id} className="hover:bg-accent/30">
                    <td className="px-3 py-1.5 font-mono">{emp.employeeNumber}</td>
                    <td className="px-3 py-1.5 font-medium">{emp.fullName}</td>
                    <td className="px-3 py-1.5">{emp.department}</td>
                    <td className="px-3 py-1.5 text-center font-mono">{att?.checkIn || '—'}</td>
                    <td className="px-3 py-1.5 text-center font-mono">{att?.checkOut || '—'}</td>
                    <td className="px-3 py-1.5 text-center">{att?.hoursWorked || 0}h</td>
                    <td className="px-3 py-1.5 text-center">
                      {att ? (
                        <Badge variant={att.status === 'present' ? 'default' : att.status === 'absent' ? 'destructive' : 'secondary'} className="text-[9px] px-1.5 py-0">
                          {att.status === 'present' ? t.hrUi.attStatusPresent :
                            att.status === 'absent' ? t.hrUi.attStatusAbsent :
                            att.status === 'late' ? t.hrUi.attStatusLate :
                            att.status === 'leave' ? t.hrUi.attStatusLeave :
                            att.status}
                        </Badge>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <div className="flex gap-1 justify-center">
                        <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1" onClick={() => markAttendance(emp.id, 'present')}>
                          <CheckCircle className="w-3 h-3" /> {att?.checkIn && !att?.checkOut ? t.hrUi.checkOut : t.hrUi.checkIn}
                        </Button>
                        <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => markAttendance(emp.id, 'absent')}>{t.hrUi.attStatusAbsent}</Button>
                        <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => markAttendance(emp.id, 'late')}>{t.hrUi.attStatusLate}</Button>
                        <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => markAttendance(emp.id, 'leave')}>{t.hrUi.attStatusLeave}</Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {employees.filter(e => e.status === 'active').length === 0 && (
            <div className="text-center py-12 text-muted-foreground text-sm">
              <Clock className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>{t.hrUi.noActiveEmployees}</p>
            </div>
          )}
        </TabsContent>

        {/* Leaves Tab */}
        <TabsContent value="ferias" className="flex-1 m-0 overflow-auto">
          <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 border-b">
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => { setLeaveForm({ employeeId: '', leaveType: 'annual', startDate: '', endDate: '', reason: '' }); setLeaveFormOpen(true); }}>
              <Plus className="w-3 h-3" /> {t.hrUi.newRequest}
            </Button>
            <div className="flex-1" />
            <div className="flex gap-2 text-xs">
              <Badge variant="outline" className="gap-1">{t.hrUi.pendingCount.replace('{count}', String(leaves.filter(l => l.status === 'pending').length))}</Badge>
              <Badge variant="outline" className="gap-1">{t.hrUi.approvedCount.replace('{count}', String(leaves.filter(l => l.status === 'approved').length))}</Badge>
            </div>
          </div>
          <table className="w-full text-xs">
            <thead className="bg-muted/60 border-b sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">{t.hrUi.employee}</th>
                <th className="px-3 py-2 text-left font-semibold w-24">{t.common.type}</th>
                <th className="px-3 py-2 text-left font-semibold w-24">{t.hrUi.start}</th>
                <th className="px-3 py-2 text-left font-semibold w-24">{t.hrUi.end}</th>
                <th className="px-3 py-2 text-center font-semibold w-16">{t.hrUi.days}</th>
                <th className="px-3 py-2 text-left font-semibold">{t.hrUi.reason}</th>
                <th className="px-3 py-2 text-center font-semibold w-20">{t.common.status}</th>
                <th className="px-3 py-2 text-center font-semibold w-36">{t.common.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {leaves.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map(leave => (
                <tr key={leave.id} className="hover:bg-accent/30">
                  <td className="px-3 py-1.5 font-medium">{leave.employeeName}</td>
                  <td className="px-3 py-1.5">{leaveTypeLabel(leave.leaveType)}</td>
                  <td className="px-3 py-1.5 font-mono">{leave.startDate}</td>
                  <td className="px-3 py-1.5 font-mono">{leave.endDate}</td>
                  <td className="px-3 py-1.5 text-center font-bold">{leave.days}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{leave.reason || '—'}</td>
                  <td className="px-3 py-1.5 text-center">
                    <Badge variant={leave.status === 'approved' ? 'default' : leave.status === 'rejected' ? 'destructive' : 'secondary'} className="text-[9px] px-1.5 py-0">
                      {leave.status === 'pending' ? t.hrUi.leaveStatusPending : leave.status === 'approved' ? t.hrUi.leaveStatusApproved : t.hrUi.leaveStatusRejected}
                    </Badge>
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    {leave.status === 'pending' && (
                      <div className="flex gap-1 justify-center">
                        <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1" onClick={() => approveLeave(leave.id)}>
                          <CheckCircle className="w-3 h-3" /> {t.hrUi.approve}
                        </Button>
                        <Button variant="ghost" size="sm" className="h-6 text-[10px] text-destructive" onClick={() => rejectLeave(leave.id)}>
                          <XCircle className="w-3 h-3" /> {t.hrUi.reject}
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {leaves.length === 0 && (
            <div className="text-center py-12 text-muted-foreground text-sm">
              <Calendar className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>{t.hrUi.noLeaveRequests}</p>
            </div>
          )}
        </TabsContent>

        {/* Contracts Tab */}
        <TabsContent value="contratos" className="flex-1 m-0 overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/60 border-b sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2 text-left font-semibold w-20">{t.hrUi.no}</th>
                <th className="px-3 py-2 text-left font-semibold">{t.hrUi.employee}</th>
                <th className="px-3 py-2 text-left font-semibold w-24">{t.common.type}</th>
                <th className="px-3 py-2 text-left font-semibold w-24">{t.hrUi.start}</th>
                <th className="px-3 py-2 text-left font-semibold w-24">{t.hrUi.end}</th>
                <th className="px-3 py-2 text-left font-semibold w-24">{t.hrUi.department}</th>
                <th className="px-3 py-2 text-left font-semibold w-24">{t.hrUi.position}</th>
                <th className="px-3 py-2 text-right font-semibold w-28">{t.hrUi.salary}</th>
                <th className="px-3 py-2 text-center font-semibold w-20">{t.common.status}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {employees.map(emp => {
                const isExpiring = emp.contractType === 'fixed_term' && emp.endDate && differenceInCalendarDays(new Date(emp.endDate), new Date()) <= 30 && differenceInCalendarDays(new Date(emp.endDate), new Date()) >= 0;
                const isExpired = emp.endDate && new Date(emp.endDate) < new Date();
                return (
                  <tr key={emp.id} className={cn("hover:bg-accent/30", isExpiring && "bg-orange-50 dark:bg-orange-950/20", isExpired && "bg-destructive/5")}>
                    <td className="px-3 py-1.5 font-mono">{emp.employeeNumber}</td>
                    <td className="px-3 py-1.5 font-medium">{emp.fullName}</td>
                    <td className="px-3 py-1.5 capitalize">{emp.contractType.replace('_', ' ')}</td>
                    <td className="px-3 py-1.5 font-mono">{emp.startDate}</td>
                    <td className="px-3 py-1.5 font-mono">{emp.endDate || t.hrUi.indefinite}</td>
                    <td className="px-3 py-1.5">{emp.department}</td>
                    <td className="px-3 py-1.5">{emp.position}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{emp.baseSalary.toLocaleString(uiLocale)} Kz</td>
                    <td className="px-3 py-1.5 text-center">
                      {isExpired ? (
                        <Badge variant="destructive" className="text-[9px] px-1.5 py-0">{t.hrUi.contractExpired}</Badge>
                      ) : isExpiring ? (
                        <Badge variant="secondary" className="text-[9px] px-1.5 py-0 border-orange-300 text-orange-600">{t.hrUi.contractExpiring}</Badge>
                      ) : emp.status === 'terminated' ? (
                        <Badge variant="destructive" className="text-[9px] px-1.5 py-0">{t.hrUi.empStatusTerminated}</Badge>
                      ) : (
                        <Badge variant="default" className="text-[9px] px-1.5 py-0">{t.hrUi.empStatusActive}</Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {employees.length === 0 && (
            <div className="text-center py-12 text-muted-foreground text-sm">
              <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>{t.hrUi.noContracts}</p>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Employee info bar */}
      {selectedEmployee && (
        <div className="h-7 bg-primary/10 border-t flex items-center px-3 text-[10px] gap-4">
          <span className="font-bold">{selectedEmployee.employeeNumber} - {selectedEmployee.fullName}</span>
          <span>{selectedEmployee.department} / {selectedEmployee.position}</span>
          <span>{t.hrUi.salaryLabel.replace('{amount}', selectedEmployee.baseSalary.toLocaleString(uiLocale))}</span>
          <span>{t.hrUi.irtLabel.replace('{amount}', calculateIRT(selectedEmployee.baseSalary).toLocaleString(uiLocale))}</span>
        </div>
      )}

      {/* Employee Form Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editEmployee ? t.hrUi.editEmployeeTitle : t.hrUi.newEmployeeTitle}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1"><Label className="text-xs">{t.hrUi.firstName} *</Label>
                <Input value={form.firstName} onChange={e => setForm(p => ({ ...p, firstName: e.target.value }))} className="h-8 text-xs" /></div>
              <div className="space-y-1"><Label className="text-xs">{t.hrUi.lastName} *</Label>
                <Input value={form.lastName} onChange={e => setForm(p => ({ ...p, lastName: e.target.value }))} className="h-8 text-xs" /></div>
              <div className="space-y-1"><Label className="text-xs">{t.hrUi.gender}</Label>
                <Select value={form.gender} onValueChange={v => setForm(p => ({ ...p, gender: v as 'M' | 'F' }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="M">{t.hrUi.genderMale}</SelectItem><SelectItem value="F">{t.hrUi.genderFemale}</SelectItem></SelectContent>
                </Select></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1"><Label className="text-xs">{t.hrUi.nif}</Label>
                <Input value={form.nif} onChange={e => setForm(p => ({ ...p, nif: e.target.value }))} className="h-8 text-xs" /></div>
              <div className="space-y-1"><Label className="text-xs">{t.hrUi.bi}</Label>
                <Input value={form.bi} onChange={e => setForm(p => ({ ...p, bi: e.target.value }))} className="h-8 text-xs" /></div>
              <div className="space-y-1"><Label className="text-xs">{t.hrUi.dateOfBirth}</Label>
                <Input type="date" value={form.dateOfBirth} onChange={e => setForm(p => ({ ...p, dateOfBirth: e.target.value }))} className="h-8 text-xs" /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1"><Label className="text-xs">{t.hrUi.phone}</Label>
                <Input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} className="h-8 text-xs" /></div>
              <div className="space-y-1"><Label className="text-xs">{t.hrUi.email}</Label>
                <Input value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} className="h-8 text-xs" /></div>
              <div className="space-y-1"><Label className="text-xs">{t.hrUi.city}</Label>
                <Input value={form.city} onChange={e => setForm(p => ({ ...p, city: e.target.value }))} className="h-8 text-xs" /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1"><Label className="text-xs">{t.hrUi.department}</Label>
                <Select value={form.department} onValueChange={v => setForm(p => ({ ...p, department: v }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{DEPARTMENTS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                </Select></div>
              <div className="space-y-1"><Label className="text-xs">{t.hrUi.position}</Label>
                <Input value={form.position} onChange={e => setForm(p => ({ ...p, position: e.target.value }))} className="h-8 text-xs" /></div>
              <div className="space-y-1"><Label className="text-xs">{t.hrUi.contractType}</Label>
                <Select value={form.contractType} onValueChange={v => setForm(p => ({ ...p, contractType: v as any }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="permanent">{t.hrUi.contractPermanent}</SelectItem>
                    <SelectItem value="fixed_term">{t.hrUi.contractFixedTerm}</SelectItem>
                    <SelectItem value="temporary">{t.hrUi.contractTemporary}</SelectItem>
                    <SelectItem value="intern">{t.hrUi.contractIntern}</SelectItem>
                  </SelectContent>
                </Select></div>
            </div>
            <div className="grid grid-cols-4 gap-3">
              <div className="space-y-1"><Label className="text-xs">{t.hrUi.baseSalaryKz} *</Label>
                <Input type="number" value={form.baseSalary} onChange={e => setForm(p => ({ ...p, baseSalary: Number(e.target.value) }))} className="h-8 text-xs" /></div>
              <div className="space-y-1"><Label className="text-xs">{t.hrUi.mealAllowance}</Label>
                <Input type="number" value={form.mealAllowance} onChange={e => setForm(p => ({ ...p, mealAllowance: Number(e.target.value) }))} className="h-8 text-xs" /></div>
              <div className="space-y-1"><Label className="text-xs">{t.hrUi.transportAllowance}</Label>
                <Input type="number" value={form.transportAllowance} onChange={e => setForm(p => ({ ...p, transportAllowance: Number(e.target.value) }))} className="h-8 text-xs" /></div>
              <div className="space-y-1"><Label className="text-xs">{t.hrUi.otherAllowances}</Label>
                <Input type="number" value={form.otherAllowances} onChange={e => setForm(p => ({ ...p, otherAllowances: Number(e.target.value) }))} className="h-8 text-xs" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">{t.hrUi.bank}</Label>
                <Input value={form.bankName} onChange={e => setForm(p => ({ ...p, bankName: e.target.value }))} placeholder={t.hrUi.bankPlaceholder} className="h-8 text-xs" /></div>
              <div className="space-y-1"><Label className="text-xs">{t.hrUi.bankAccountNo}</Label>
                <Input value={form.bankAccount} onChange={e => setForm(p => ({ ...p, bankAccount: e.target.value }))} className="h-8 text-xs" /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>{t.common.cancel}</Button>
            <Button onClick={saveEmployee}>{t.common.save}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payroll Generation Dialog */}
      <Dialog open={payrollOpen} onOpenChange={setPayrollOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{t.hrUi.payrollDialogTitle}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs">{t.common.period}</Label>
              <Input type="month" value={payrollMonth} onChange={e => setPayrollMonth(e.target.value)} className="h-8 text-xs" />
            </div>
            <p className="text-xs text-muted-foreground">
              {t.hrUi.payrollDialogHint
                .replace('{count}', String(employees.filter(e => e.status === 'active').length))}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayrollOpen(false)}>{t.common.cancel}</Button>
            <Button onClick={generatePayroll}>{t.hrUi.generate}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Leave Request Dialog */}
      <Dialog open={leaveFormOpen} onOpenChange={setLeaveFormOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t.hrUi.newLeaveRequestTitle}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">{t.hrUi.employee} *</Label>
              <Select value={leaveForm.employeeId} onValueChange={v => setLeaveForm(p => ({ ...p, employeeId: v }))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t.hrUi.selectPlaceholder} /></SelectTrigger>
                <SelectContent>
                  {employees.filter(e => e.status === 'active').map(emp => (
                    <SelectItem key={emp.id} value={emp.id}>{emp.fullName} ({emp.employeeNumber})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t.common.type} *</Label>
              <Select value={leaveForm.leaveType} onValueChange={v => setLeaveForm(p => ({ ...p, leaveType: v as LeaveRequest['leaveType'] }))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="annual">{t.hrUi.leaveTypes.annual}</SelectItem>
                  <SelectItem value="sick">{t.hrUi.leaveTypes.sick}</SelectItem>
                  <SelectItem value="maternity">{t.hrUi.leaveTypes.maternity}</SelectItem>
                  <SelectItem value="paternity">{t.hrUi.leaveTypes.paternity}</SelectItem>
                  <SelectItem value="unpaid">{t.hrUi.leaveTypes.unpaid}</SelectItem>
                  <SelectItem value="other">{t.hrUi.leaveTypes.other}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{t.hrUi.startDate} *</Label>
                <Input type="date" value={leaveForm.startDate} onChange={e => setLeaveForm(p => ({ ...p, startDate: e.target.value }))} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t.hrUi.endDate} *</Label>
                <Input type="date" value={leaveForm.endDate} onChange={e => setLeaveForm(p => ({ ...p, endDate: e.target.value }))} className="h-8 text-xs" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t.hrUi.reason}</Label>
              <Input value={leaveForm.reason} onChange={e => setLeaveForm(p => ({ ...p, reason: e.target.value }))} className="h-8 text-xs" placeholder={t.hrUi.optionalPlaceholder} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLeaveFormOpen(false)}>{t.common.cancel}</Button>
            <Button onClick={submitLeave}>{t.hrUi.submitRequest}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
