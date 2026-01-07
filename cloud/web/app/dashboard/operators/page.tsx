'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { Plus, Edit, UserX, UserCheck, RefreshCw, Users, Shield, Key } from 'lucide-react';

interface Operator {
  id: string;
  name: string;
  role: 'OPERATOR' | 'SUPERVISOR';
  isActive: boolean;
  createdAt: string;
  transactionCount: number;
}

export default function OperatorsPage() {
  const { data: session, status } = useSession();
  const { toast } = useToast();
  const [operators, setOperators] = useState<Operator[]>([]);
  const [loading, setLoading] = useState(true);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [resetPinDialogOpen, setResetPinDialogOpen] = useState(false);
  const [selectedOperator, setSelectedOperator] = useState<Operator | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formPin, setFormPin] = useState('');
  const [formRole, setFormRole] = useState<'OPERATOR' | 'SUPERVISOR'>('OPERATOR');

  // Auth check
  useEffect(() => {
    if (status === 'unauthenticated') {
      redirect('/login');
    }
  }, [status]);

  // Check for OWNER role
  if (status === 'authenticated' && session?.user?.role !== 'OWNER') {
    redirect('/dashboard');
  }

  // Fetch operators
  const fetchOperators = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/owner/operators');
      const data = await res.json();
      if (data.ok) {
        setOperators(data.operators);
      }
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to load operators', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (status === 'authenticated') {
      fetchOperators();
    }
  }, [status]);

  // Add operator
  const handleAddOperator = async () => {
    if (!formName.trim() || !formPin.trim()) {
      toast({ title: 'Error', description: 'Name and PIN are required', variant: 'destructive' });
      return;
    }

    if (formPin.length < 4 || !/^\d+$/.test(formPin)) {
      toast({ title: 'Error', description: 'PIN must be at least 4 digits', variant: 'destructive' });
      return;
    }

    try {
      const res = await fetch('/api/owner/operators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: formName, pin: formPin, role: formRole }),
      });
      const data = await res.json();

      if (data.ok) {
        toast({ title: 'Success', description: 'Operator created successfully' });
        setAddDialogOpen(false);
        setFormName('');
        setFormPin('');
        setFormRole('OPERATOR');
        fetchOperators();
      } else {
        toast({ title: 'Error', description: data.error || 'Failed to create operator', variant: 'destructive' });
      }
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to create operator', variant: 'destructive' });
    }
  };

  // Update operator
  const handleUpdateOperator = async () => {
    if (!selectedOperator) return;

    try {
      const res = await fetch(`/api/owner/operators/${selectedOperator.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: formName || undefined, role: formRole }),
      });
      const data = await res.json();

      if (data.ok) {
        toast({ title: 'Success', description: 'Operator updated successfully' });
        setEditDialogOpen(false);
        setSelectedOperator(null);
        fetchOperators();
      } else {
        toast({ title: 'Error', description: data.error || 'Failed to update operator', variant: 'destructive' });
      }
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to update operator', variant: 'destructive' });
    }
  };

  // Reset PIN
  const handleResetPin = async () => {
    if (!selectedOperator || !formPin.trim()) return;

    if (formPin.length < 4 || !/^\d+$/.test(formPin)) {
      toast({ title: 'Error', description: 'PIN must be at least 4 digits', variant: 'destructive' });
      return;
    }

    try {
      const res = await fetch(`/api/owner/operators/${selectedOperator.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: formPin }),
      });
      const data = await res.json();

      if (data.ok) {
        toast({ title: 'Success', description: 'PIN reset successfully' });
        setResetPinDialogOpen(false);
        setSelectedOperator(null);
        setFormPin('');
      } else {
        toast({ title: 'Error', description: data.error || 'Failed to reset PIN', variant: 'destructive' });
      }
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to reset PIN', variant: 'destructive' });
    }
  };

  // Toggle active status
  const handleToggleActive = async (operator: Operator) => {
    try {
      const res = await fetch(`/api/owner/operators/${operator.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !operator.isActive }),
      });
      const data = await res.json();

      if (data.ok) {
        toast({
          title: 'Success',
          description: `Operator ${operator.isActive ? 'deactivated' : 'activated'}`,
        });
        fetchOperators();
      } else {
        toast({ title: 'Error', description: data.error || 'Failed to update operator', variant: 'destructive' });
      }
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to update operator', variant: 'destructive' });
    }
  };

  if (status === 'loading' || loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const activeCount = operators.filter((o) => o.isActive).length;
  const supervisorCount = operators.filter((o) => o.role === 'SUPERVISOR').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Operators</h1>
          <p className="text-muted-foreground">Manage operator accounts and PINs</p>
        </div>
        <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Operator
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Operator</DialogTitle>
              <DialogDescription>
                Create a new operator account. They will use the PIN to log into the dispenser.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="John Doe"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pin">PIN (4-8 digits)</Label>
                <Input
                  id="pin"
                  type="password"
                  value={formPin}
                  onChange={(e) => setFormPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                  placeholder="••••"
                  maxLength={8}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="role">Role</Label>
                <Select value={formRole} onValueChange={(v) => setFormRole(v as any)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="OPERATOR">Operator</SelectItem>
                    <SelectItem value="SUPERVISOR">Supervisor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleAddOperator}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Operators</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{operators.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active</CardTitle>
            <UserCheck className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Supervisors</CardTitle>
            <Shield className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{supervisorCount}</div>
          </CardContent>
        </Card>
      </div>

      {/* Operators Table */}
      <Card>
        <CardHeader>
          <CardTitle>All Operators</CardTitle>
          <CardDescription>
            {operators.length} operator{operators.length !== 1 ? 's' : ''} registered
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Transactions</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {operators.map((op) => (
                <TableRow key={op.id} className={!op.isActive ? 'opacity-50' : ''}>
                  <TableCell className="font-medium">{op.name}</TableCell>
                  <TableCell>
                    <Badge variant={op.role === 'SUPERVISOR' ? 'default' : 'secondary'}>
                      {op.role}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={op.isActive ? 'default' : 'destructive'}>
                      {op.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">{op.transactionCount}</TableCell>
                  <TableCell>{new Date(op.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {/* Edit */}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setSelectedOperator(op);
                          setFormName(op.name);
                          setFormRole(op.role);
                          setEditDialogOpen(true);
                        }}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      {/* Reset PIN */}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setSelectedOperator(op);
                          setFormPin('');
                          setResetPinDialogOpen(true);
                        }}
                      >
                        <Key className="h-4 w-4" />
                      </Button>
                      {/* Toggle Active */}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleToggleActive(op)}
                      >
                        {op.isActive ? (
                          <UserX className="h-4 w-4 text-destructive" />
                        ) : (
                          <UserCheck className="h-4 w-4 text-green-500" />
                        )}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {operators.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No operators found. Add your first operator to get started.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Operator</DialogTitle>
            <DialogDescription>Update operator details</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-role">Role</Label>
              <Select value={formRole} onValueChange={(v) => setFormRole(v as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="OPERATOR">Operator</SelectItem>
                  <SelectItem value="SUPERVISOR">Supervisor</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateOperator}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset PIN Dialog */}
      <Dialog open={resetPinDialogOpen} onOpenChange={setResetPinDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset PIN</DialogTitle>
            <DialogDescription>
              Set a new PIN for {selectedOperator?.name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="new-pin">New PIN (4-8 digits)</Label>
              <Input
                id="new-pin"
                type="password"
                value={formPin}
                onChange={(e) => setFormPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                placeholder="••••"
                maxLength={8}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetPinDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleResetPin}>Reset PIN</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
