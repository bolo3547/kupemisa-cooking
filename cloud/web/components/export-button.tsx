'use client';

import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

interface ExportButtonProps {
  data: any[];
  filename: string;
  title?: string;
  columns?: { header: string; dataKey: string }[];
  type?: 'pdf' | 'excel';
}

export function ExportButton({ data, filename, title, columns, type = 'excel' }: ExportButtonProps) {
  const exportToPDF = () => {
    const doc = new jsPDF();
    
    doc.setFontSize(18);
    doc.text(title || 'Export Report', 14, 22);
    
    doc.setFontSize(11);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 30);

    const tableColumns = columns || Object.keys(data[0] || {}).map(key => ({
      header: key.replace(/([A-Z])/g, ' $1').trim(),
      dataKey: key
    }));

    autoTable(doc, {
      startY: 35,
      head: [tableColumns.map(col => col.header)],
      body: data.map(row => tableColumns.map(col => row[col.dataKey] || '')),
      theme: 'striped',
      headStyles: { fillColor: [59, 130, 246] },
      styles: { fontSize: 9 },
    });

    doc.save(`${filename}.pdf`);
  };

  const exportToExcel = () => {
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Data');
    
    const colWidths = Object.keys(data[0] || {}).map(() => ({ wch: 15 }));
    worksheet['!cols'] = colWidths;
    
    XLSX.writeFile(workbook, `${filename}.xlsx`);
  };

  const handleExport = () => {
    if (data.length === 0) {
      alert('No data to export');
      return;
    }

    if (type === 'pdf') {
      exportToPDF();
    } else {
      exportToExcel();
    }
  };

  return (
    <Button onClick={handleExport} variant="outline" size="sm">
      <Download className="h-4 w-4 mr-2" />
      Export {type === 'pdf' ? 'PDF' : 'Excel'}
    </Button>
  );
}
