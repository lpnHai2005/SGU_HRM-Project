// ============================================
// Auth Context - Global Authentication State
// ============================================

import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import type { UserRole } from '../types';
import { authApi, userService, tokenService, clearAuth } from '../services/api';

interface AuthUser {
  user_id: number;
  username: string;
  full_name?: string | null;
  roles: string[];
  permissions: string[];
  employee_id?: number | null;
  store_id?: number | null;
  store_name?: string | null;
}

interface AuthContextType {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasRole: (role: UserRole | UserRole[]) => boolean;
  hasPermission: (permission: string) => boolean;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Check for existing session on mount
  useEffect(() => {
    const initAuth = async () => {
      const storedUser = userService.get();
      const token = tokenService.get();

      if (storedUser && token) {
        setUser(storedUser);

        // Optionally verify token still valid
        try {
          const profile = await authApi.getMe();
          setUser({
            user_id: profile.user_id,
            username: profile.username,
            full_name: profile.full_name,
            roles: profile.roles,
            permissions: profile.permissions,
            employee_id: profile.employee_id,
            store_id: profile.store_id,
            store_name: profile.store_name,
          });
          userService.set({
            user_id: profile.user_id,
            username: profile.username,
            full_name: profile.full_name,
            roles: profile.roles,
            permissions: profile.permissions,
            employee_id: profile.employee_id,
            store_id: profile.store_id,
            store_name: profile.store_name,
          });
        } catch {
          // Token invalid, clear auth
          clearAuth();
          setUser(null);
        }
      }

      setIsLoading(false);
    };

    initAuth();
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    try {
      const response = await authApi.login(username, password);

      const authUser: AuthUser = {
        user_id: response.user_id,
        username: response.username,
        full_name: response.full_name,
        roles: response.roles,
        permissions: response.permissions,
        employee_id: response.employee_id,
        store_id: response.store_id,
        store_name: response.store_name,
      };

      setUser(authUser);
    } catch (error) {
      clearAuth();
      throw error;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      clearAuth();
      setUser(null);
    }
  }, []);

  const hasRole = useCallback((role: UserRole | UserRole[]): boolean => {
    if (!user) return false;
    const roles = Array.isArray(role) ? role : [role];
    return roles.some(r => user.roles.includes(r));
  }, [user]);

  const hasPermission = useCallback((permission: string): boolean => {
    if (!user) return false;
    // ADMIN has all permissions
    if (user.roles.includes('ADMIN')) return true;
    return user.permissions.includes(permission);
  }, [user]);

  const refreshUser = useCallback(async () => {
    try {
      const profile = await authApi.getMe();
      const authUser: AuthUser = {
        user_id: profile.user_id,
        username: profile.username,
        full_name: profile.full_name,
        roles: profile.roles,
        permissions: profile.permissions,
        employee_id: profile.employee_id,
        store_id: profile.store_id,
        store_name: profile.store_name,
      };
      setUser(authUser);
      userService.set(authUser);
    } catch (error) {
      clearAuth();
      setUser(null);
      throw error;
    }
  }, []);

  const value: AuthContextType = {
    user,
    isAuthenticated: !!user,
    isLoading,
    login,
    logout,
    hasRole,
    hasPermission,
    refreshUser,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

// ============================================
// App Context - Global Application State
// ============================================

import type { Employee, Attendance, LeaveBalance, LeaveRequest, Payroll, AuditLog, Lookups } from '../types';
import { employeeApi, attendanceApi, leaveApi, payrollApi, auditApi } from '../services/api';

interface AppState {
  employees: Employee[];
  lookups: Lookups | null;
  myAttendance: Attendance[];
  leaveBalance: LeaveBalance | null;
  leaveRequests: LeaveRequest[];
  payrolls: Payroll[];
  auditLogs: AuditLog[];
  isLoading: boolean;
}

interface AppContextType extends AppState {
  // Employee actions
  fetchEmployees: (params?: any) => Promise<void>;
  fetchLookups: () => Promise<void>;

  // Attendance actions
  fetchMyAttendance: (period?: string) => Promise<void>;
  checkIn: (data?: any) => Promise<any>;
  checkOut: (attendanceId: number) => Promise<any>;

  // Leave actions
  fetchLeaveBalance: () => Promise<void>;
  fetchLeaveRequests: (status?: string) => Promise<void>;
  createLeaveRequest: (data: any) => Promise<void>;
  approveLeave: (requestId: number, level: 'store' | 'hr') => Promise<void>;
  rejectLeave: (requestId: number, reason: string) => Promise<void>;

  // Payroll actions
  fetchPayrolls: (period?: string) => Promise<void>;

  // Audit actions
  fetchAuditLogs: (params?: any) => Promise<void>;

  // Utility
  clearAppState: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [state, setState] = useState<AppState>({
    employees: [],
    lookups: null,
    myAttendance: [],
    leaveBalance: null,
    leaveRequests: [],
    payrolls: [],
    auditLogs: [],
    isLoading: false,
  });

  // Employee actions
  const fetchEmployees = useCallback(async (params?: any) => {
    setState(prev => ({ ...prev, isLoading: true }));
    try {
      const employees = await employeeApi.getAll(params);
      setState(prev => ({ ...prev, employees, isLoading: false }));
    } catch (error) {
      setState(prev => ({ ...prev, isLoading: false }));
      throw error;
    }
  }, []);

  const fetchLookups = useCallback(async () => {
    try {
      const lookups = await employeeApi.getLookups();
      setState(prev => ({ ...prev, lookups }));
    } catch (error) {
      throw error;
    }
  }, []);

  // Attendance actions
  const fetchMyAttendance = useCallback(async (period?: string) => {
    setState(prev => ({ ...prev, isLoading: true }));
    try {
      const myAttendance = await attendanceApi.getMyHistory(period);
      setState(prev => ({ ...prev, myAttendance, isLoading: false }));
    } catch (error) {
      setState(prev => ({ ...prev, isLoading: false }));
      throw error;
    }
  }, []);

  const checkIn = useCallback(async (data?: any) => {
    const result = await attendanceApi.checkIn(data);
    // Refresh attendance after check-in
    await fetchMyAttendance();
    return result;
  }, [fetchMyAttendance]);

  const checkOut = useCallback(async (attendanceId: number) => {
    const result = await attendanceApi.checkOut({ attendance_id: attendanceId });
    // Refresh attendance after check-out
    await fetchMyAttendance();
    return result;
  }, [fetchMyAttendance]);

  // Leave actions
  const fetchLeaveBalance = useCallback(async () => {
    try {
      const leaveBalance = await leaveApi.getMyBalance();
      setState(prev => ({ ...prev, leaveBalance }));
    } catch (error) {
      throw error;
    }
  }, []);

  const fetchLeaveRequests = useCallback(async (status?: string) => {
    setState(prev => ({ ...prev, isLoading: true }));
    try {
      const leaveRequests = await leaveApi.getAll(status ? { status } : undefined);
      setState(prev => ({ ...prev, leaveRequests, isLoading: false }));
    } catch (error) {
      setState(prev => ({ ...prev, isLoading: false }));
      throw error;
    }
  }, []);

  const createLeaveRequest = useCallback(async (data: any) => {
    await leaveApi.create(data);
    // Refresh leave requests
    await fetchLeaveRequests();
    await fetchLeaveBalance();
  }, [fetchLeaveRequests, fetchLeaveBalance]);

  const approveLeave = useCallback(async (requestId: number, level: 'store' | 'hr') => {
    if (level === 'store') {
      await leaveApi.approveStore(requestId);
    } else {
      await leaveApi.approveHr(requestId);
    }
    await fetchLeaveRequests();
  }, [fetchLeaveRequests]);

  const rejectLeave = useCallback(async (requestId: number, reason: string) => {
    await leaveApi.reject(requestId, { rejection_reason: reason });
    await fetchLeaveRequests();
  }, [fetchLeaveRequests]);

  // Payroll actions
  const fetchPayrolls = useCallback(async (period?: string) => {
    setState(prev => ({ ...prev, isLoading: true }));
    try {
      const payrolls = await payrollApi.getAll(period ? { period } : undefined);
      setState(prev => ({ ...prev, payrolls, isLoading: false }));
    } catch (error) {
      setState(prev => ({ ...prev, isLoading: false }));
      throw error;
    }
  }, []);

  // Audit actions
  const fetchAuditLogs = useCallback(async (params?: any) => {
    setState(prev => ({ ...prev, isLoading: true }));
    try {
      const auditLogs = await auditApi.getAll(params);
      setState(prev => ({ ...prev, auditLogs, isLoading: false }));
    } catch (error) {
      setState(prev => ({ ...prev, isLoading: false }));
      throw error;
    }
  }, []);

  // Utility
  const clearAppState = useCallback(() => {
    setState({
      employees: [],
      lookups: null,
      myAttendance: [],
      leaveBalance: null,
      leaveRequests: [],
      payrolls: [],
      auditLogs: [],
      isLoading: false,
    });
  }, []);

  const value: AppContextType = {
    ...state,
    fetchEmployees,
    fetchLookups,
    fetchMyAttendance,
    checkIn,
    checkOut,
    fetchLeaveBalance,
    fetchLeaveRequests,
    createLeaveRequest,
    approveLeave,
    rejectLeave,
    fetchPayrolls,
    fetchAuditLogs,
    clearAppState,
  };

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = (): AppContextType => {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
