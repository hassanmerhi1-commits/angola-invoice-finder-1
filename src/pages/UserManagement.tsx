import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useERP';
import { useBranchContext } from '@/contexts/BranchContext';
import { useUsers } from '@/hooks/useUsers';
import { useTranslation } from '@/i18n';
import { User } from '@/types/erp';
import { 
  UserRole, 
  PERMISSIONS, 
  ROLE_NAMES, 
  ROLE_COLORS,
  DEFAULT_ROLE_PERMISSIONS,
  getEffectivePermissions,
  diffOverridesFromEffective,
  hasOverrides,
} from '@/lib/permissions';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Users, 
  Shield, 
  UserPlus,
  Search,
  Edit,
  Trash2,
  Check,
  X,
  Power,
  Loader2
} from 'lucide-react';
import { toast } from 'sonner';

export default function UserManagement() {
  const { t } = useTranslation();
  const { user: currentUser } = useAuth();
  const { branches } = useBranchContext();
  const isAdmin = currentUser?.role === 'admin';
  const { users, isLoading, createUser, updateUser, deleteUser, toggleUserActive } = useUsers();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  
  // Form states
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    username: '',
    role: 'cashier' as UserRole,
    branchId: '',
    password: '',
  });
  const [selectedRole, setSelectedRole] = useState<UserRole>('viewer');
  const [customPerms, setCustomPerms] = useState<string[]>([]);
  const [useCustomPerms, setUseCustomPerms] = useState(false);
  const [editPassword, setEditPassword] = useState('');
  const [editPasswordConfirm, setEditPasswordConfirm] = useState('');

  const filteredUsers = users.filter(u =>
    u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (u.username?.toLowerCase().includes(searchTerm.toLowerCase()) ?? false)
  );

  const getUserRoleDisplay = (_userId: string, defaultRole: UserRole): UserRole => defaultRole;

  const handleEditUser = (user: User) => {
    setSelectedUser(user);
    const currentRole = user.role;
    setSelectedRole(currentRole);

    const overridden = hasOverrides(user.permissionOverrides);
    setUseCustomPerms(overridden);
    // Show the effective permission set as the starting point for the toggles.
    setCustomPerms(getEffectivePermissions(currentRole, user.permissionOverrides));

    setEditPassword('');
    setEditPasswordConfirm('');
    setEditDialogOpen(true);
  };

  const handleCreateUser = async () => {
    if (!formData.name || !formData.email || !formData.branchId) {
      toast.error('Please fill in all required fields');
      return;
    }
    if (!formData.password || formData.password.length < 8) {
      toast.error('Password is required (minimum 8 characters)');
      return;
    }
    
    try {
      await createUser({
        name: formData.name,
        email: formData.email,
        username: formData.username || formData.email.split('@')[0],
        role: formData.role,
        branchId: formData.branchId,
        password: formData.password,
      });

      toast.success(`User "${formData.name}" created successfully`);
      setCreateDialogOpen(false);
      setFormData({ name: '', email: '', username: '', role: 'cashier', branchId: '', password: '' });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create user');
    }
  };

  const handleSaveRole = async () => {
    if (!selectedUser) return;

    const pwd = editPassword.trim();
    if (pwd || editPasswordConfirm.trim()) {
      if (pwd.length < 8) {
        toast.error(t.passwordChangeUi.minLength);
        return;
      }
      if (pwd !== editPasswordConfirm.trim()) {
        toast.error(t.passwordChangeUi.mismatch);
        return;
      }
    }
    
    try {
      // Custom on → store grant/revoke deltas vs the role. Custom off → clear overrides.
      const permissionOverrides = useCustomPerms
        ? diffOverridesFromEffective(selectedRole, customPerms)
        : { granted: [], revoked: [] };

      await updateUser({
        ...selectedUser,
        role: selectedRole,
        permissionOverrides,
        ...(pwd ? { password: pwd } : {}),
      });

      toast.success(
        pwd ? t.userManagementUi.roleAndPasswordUpdated : t.userManagementUi.roleUpdated,
        { description: selectedUser.name },
      );
      setEditPassword('');
      setEditPasswordConfirm('');
      setEditDialogOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update user');
    }
  };

  const handleDeleteUser = async () => {
    if (!userToDelete) return;
    
    if (userToDelete.id === currentUser?.id) {
      toast.error('You cannot delete your own account');
      return;
    }
    
    try {
      await deleteUser(userToDelete.id);
      toast.success(`User "${userToDelete.name}" deleted`);
      setDeleteDialogOpen(false);
      setUserToDelete(null);
    } catch (error) {
      toast.error('Failed to delete user');
    }
  };

  const handleToggleActive = async (user: User) => {
    if (user.id === currentUser?.id) {
      toast.error('You cannot deactivate your own account');
      return;
    }
    
    await toggleUserActive(user.id);
    toast.success(`User "${user.name}" ${user.isActive ? 'deactivated' : 'activated'}`);
  };

  const handleRoleChange = (role: UserRole) => {
    setSelectedRole(role);
    if (!useCustomPerms) {
      const rolePerms = DEFAULT_ROLE_PERMISSIONS.find(rp => rp.role === role);
      setCustomPerms(rolePerms?.permissions || []);
    }
  };

  const togglePermission = (permId: string) => {
    setCustomPerms(prev => 
      prev.includes(permId) 
        ? prev.filter(p => p !== permId)
        : [...prev, permId]
    );
  };

  const permissionsByCategory = PERMISSIONS.reduce((acc, perm) => {
    if (!acc[perm.category]) acc[perm.category] = [];
    acc[perm.category].push(perm);
    return acc;
  }, {} as Record<string, typeof PERMISSIONS>);

  // Role baseline for the currently selected role — used to flag added/removed permissions.
  const roleDefaultPerms = new Set(
    DEFAULT_ROLE_PERMISSIONS.find(rp => rp.role === selectedRole)?.permissions ?? [],
  );

  if (!isAdmin) {
    return (
      <div className="p-6">
        <Card className="border-destructive">
          <CardContent className="py-12 text-center">
            <Shield className="w-12 h-12 mx-auto mb-4 text-destructive" />
            <h2 className="text-xl font-bold mb-2">Access Denied</h2>
            <p className="text-muted-foreground">
              You need administrator privileges to access this page.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="w-6 h-6" />
            User Management
          </h1>
          <p className="text-muted-foreground">
            Manage user accounts, roles and permissions
          </p>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)}>
          <UserPlus className="w-4 h-4 mr-2" />
          Add User
        </Button>
      </div>

      <Tabs defaultValue="users" className="space-y-4">
        <TabsList>
          <TabsTrigger value="users" className="gap-2">
            <Users className="w-4 h-4" />
            Users
          </TabsTrigger>
          <TabsTrigger value="roles" className="gap-2">
            <Shield className="w-4 h-4" />
            Roles Overview
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>All Users ({users.length})</CardTitle>
                <div className="relative w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search users..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Branch</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers.map(user => {
                      const role = user.role;
                      const hasCustom = hasOverrides(user.permissionOverrides);
                      const branch = branches.find(b => b.id === user.branchId);
                      
                      return (
                        <TableRow key={user.id} className={!user.isActive ? 'opacity-50' : ''}>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                                <span className="font-bold text-primary">
                                  {user.name.charAt(0).toUpperCase()}
                                </span>
                              </div>
                              <div>
                                <p className="font-medium">{user.name}</p>
                                <p className="text-xs text-muted-foreground">
                                  @{user.username || user.email.split('@')[0]}
                                </p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>{user.email}</TableCell>
                          <TableCell>
                            <span className="text-sm">{branch?.name || 'N/A'}</span>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Badge className={ROLE_COLORS[role]}>
                                {ROLE_NAMES[role]}
                              </Badge>
                              {hasCustom && (
                                <Badge variant="outline" className="text-orange-500 border-orange-500 text-xs">
                                  Custom
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={user.isActive ? 'default' : 'secondary'}>
                              {user.isActive ? 'Active' : 'Inactive'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button 
                                variant="ghost" 
                                size="sm"
                                onClick={() => handleEditUser(user)}
                                title="Edit user"
                              >
                                <Edit className="w-4 h-4" />
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="sm"
                                onClick={() => handleToggleActive(user)}
                                title={user.isActive ? 'Deactivate' : 'Activate'}
                                disabled={user.id === currentUser?.id}
                              >
                                <Power className={`w-4 h-4 ${user.isActive ? 'text-green-500' : 'text-red-500'}`} />
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="sm"
                                onClick={() => {
                                  setUserToDelete(user);
                                  setDeleteDialogOpen(true);
                                }}
                                title="Delete user"
                                disabled={user.id === currentUser?.id}
                                className="text-destructive hover:text-destructive"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {filteredUsers.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                          No users found
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="roles">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {(Object.keys(ROLE_NAMES) as UserRole[]).map(role => {
              const rolePerms = DEFAULT_ROLE_PERMISSIONS.find(rp => rp.role === role);
              const usersWithRole = users.filter(u => getUserRoleDisplay(u.id, u.role) === role).length;
              
              return (
                <Card key={role}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <Badge className={ROLE_COLORS[role]}>
                        {ROLE_NAMES[role]}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {usersWithRole} users
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground mb-3">
                      {rolePerms?.permissions.length || 0} permissions
                    </p>
                    <div className="space-y-1">
                      {Object.entries(permissionsByCategory).slice(0, 3).map(([cat, perms]) => {
                        const categoryPerms = perms.filter(p => 
                          rolePerms?.permissions.includes(p.id)
                        );
                        return (
                          <div key={cat} className="flex items-center gap-2 text-xs">
                            {categoryPerms.length > 0 ? (
                              <Check className="w-3 h-3 text-green-500" />
                            ) : (
                              <X className="w-3 h-3 text-red-500" />
                            )}
                            <span className="capitalize">{cat}</span>
                            <span className="text-muted-foreground">
                              ({categoryPerms.length}/{perms.length})
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Permission Matrix</CardTitle>
              <CardDescription>
                Overview of permissions by role
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[200px]">Permission</TableHead>
                      {(Object.keys(ROLE_NAMES) as UserRole[]).map(role => (
                        <TableHead key={role} className="text-center">
                          <Badge className={ROLE_COLORS[role]} variant="outline">
                            {ROLE_NAMES[role]}
                          </Badge>
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(permissionsByCategory).map(([category, perms]) => (
                      <>
                        <TableRow key={category} className="bg-muted/50">
                          <TableCell colSpan={5} className="font-bold capitalize">
                            {category}
                          </TableCell>
                        </TableRow>
                        {perms.map(perm => (
                          <TableRow key={perm.id}>
                            <TableCell>
                              <div>
                                <p className="font-medium text-sm">{perm.name}</p>
                                <p className="text-xs text-muted-foreground">{perm.description}</p>
                              </div>
                            </TableCell>
                            {(Object.keys(ROLE_NAMES) as UserRole[]).map(role => {
                              const rolePerms = DEFAULT_ROLE_PERMISSIONS.find(rp => rp.role === role);
                              const hasIt = rolePerms?.permissions.includes(perm.id);
                              return (
                                <TableCell key={role} className="text-center">
                                  {hasIt ? (
                                    <Check className="w-5 h-5 text-green-500 mx-auto" />
                                  ) : (
                                    <X className="w-5 h-5 text-red-300 mx-auto" />
                                  )}
                                </TableCell>
                              );
                            })}
                          </TableRow>
                        ))}
                      </>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create User Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create New User</DialogTitle>
            <DialogDescription>
              Add a new user to the system
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Full Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder={t.userManagementUi.fullNamePlaceholder}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email *</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                placeholder="joao@company.com"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                value={formData.username}
                onChange={(e) => setFormData(prev => ({ ...prev, username: e.target.value }))}
                placeholder="joaosilva"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password *</Label>
              <Input
                id="password"
                type="password"
                value={formData.password}
                onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
                placeholder="••••••••"
                minLength={8}
              />
              <p className="text-xs text-muted-foreground">
                Login: use the username, the part before @ in the email, or the full email — with this exact password.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Role *</Label>
              <Select 
                value={formData.role} 
                onValueChange={(v) => setFormData(prev => ({ ...prev, role: v as UserRole }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(ROLE_NAMES) as UserRole[]).map(role => (
                    <SelectItem key={role} value={role}>
                      <div className="flex items-center gap-2">
                        <div className={`w-3 h-3 rounded-full ${ROLE_COLORS[role]}`} />
                        {ROLE_NAMES[role]}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Branch *</Label>
              <Select 
                value={formData.branchId} 
                onValueChange={(v) => setFormData(prev => ({ ...prev, branchId: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select branch" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map(branch => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateUser}>
              Create User
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit User Role & Permissions</DialogTitle>
            <DialogDescription>
              Configure access for {selectedUser?.name}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            <div className="rounded-lg border p-4 space-y-3 bg-muted/30">
              <p className="text-sm font-medium">{t.userManagementUi.resetPasswordSection}</p>
              <p className="text-xs text-muted-foreground">{t.userManagementUi.resetPasswordHint}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="edit-new-password">{t.passwordChangeUi.newPassword}</Label>
                  <Input
                    id="edit-new-password"
                    type="password"
                    autoComplete="new-password"
                    value={editPassword}
                    onChange={(e) => setEditPassword(e.target.value)}
                    placeholder="••••••••"
                    minLength={8}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-confirm-password">{t.passwordChangeUi.confirmPassword}</Label>
                  <Input
                    id="edit-confirm-password"
                    type="password"
                    autoComplete="new-password"
                    value={editPasswordConfirm}
                    onChange={(e) => setEditPasswordConfirm(e.target.value)}
                    placeholder="••••••••"
                    minLength={8}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={selectedRole} onValueChange={(v) => handleRoleChange(v as UserRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(ROLE_NAMES) as UserRole[]).map(role => (
                    <SelectItem key={role} value={role}>
                      <div className="flex items-center gap-2">
                        <div className={`w-3 h-3 rounded-full ${ROLE_COLORS[role]}`} />
                        {ROLE_NAMES[role]}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="customPerms"
                checked={useCustomPerms}
                onCheckedChange={(checked) => setUseCustomPerms(!!checked)}
              />
              <Label htmlFor="customPerms">
                Use custom permissions (override role defaults)
              </Label>
            </div>

            {useCustomPerms && (
              <div className="space-y-4 border rounded-lg p-4">
                {Object.entries(permissionsByCategory).map(([category, perms]) => (
                  <div key={category}>
                    <h4 className="font-medium capitalize mb-2">{category}</h4>
                    <div className="grid gap-2 md:grid-cols-2">
                      {perms.map(perm => {
                        const isDefault = roleDefaultPerms.has(perm.id);
                        const isChecked = customPerms.includes(perm.id);
                        const added = isChecked && !isDefault;
                        const removed = !isChecked && isDefault;
                        return (
                          <div key={perm.id} className="flex items-center space-x-2">
                            <Checkbox
                              id={perm.id}
                              checked={isChecked}
                              onCheckedChange={() => togglePermission(perm.id)}
                            />
                            <Label htmlFor={perm.id} className="text-sm">
                              {perm.name}
                            </Label>
                            {added && (
                              <Badge variant="outline" className="text-green-600 border-green-600 text-[10px] px-1 py-0">
                                {t.userManagementUi.permAdded}
                              </Badge>
                            )}
                            {removed && (
                              <Badge variant="outline" className="text-red-500 border-red-500 text-[10px] px-1 py-0">
                                {t.userManagementUi.permRemoved}
                              </Badge>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveRole}>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{userToDelete?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteUser} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
