import { useState, useEffect, useCallback } from 'react';
import {
    Search,
    ChevronUp,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Download,
    X,
    Snowflake,
    AlertTriangle,
    FileText,
    Check,
    XCircle,
    Send,
    History
} from 'lucide-react';
import { certificateApi, auditApi } from '../api';
import type { Certificate, CertificateExportFilters, ActivityItem } from '../api';
import Modal from './Modal';

type SortField = 'recipientName' | 'title' | 'issuerName' | 'issueDate' | 'status' | 'serialNumber';
type SortOrder = 'asc' | 'desc';

interface CertificateTableProps {
    onError?: (message: string) => void;
    onSuccess?: (message: string) => void;
}

const useDebounce = (value: string, delay: number) => {
    const [debouncedValue, setDebouncedValue] = useState(value);

    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedValue(value);
        }, delay);

        return () => {
            clearTimeout(handler);
        };
    }, [value, delay]);

    return debouncedValue;
};

const CertificateTable = ({ onError, onSuccess }: CertificateTableProps) => {
    const [certificates, setCertificates] = useState<Certificate[]>([]);
    const [loading, setLoading] = useState(true);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(10);
    const [totalPages, setTotalPages] = useState(0);

    const [search, setSearch] = useState('');
    const debouncedSearch = useDebounce(search, 300);
    const [statusFilter, setStatusFilter] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');

    const [sortBy, setSortBy] = useState<SortField>('issueDate');
    const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [selectAll, setSelectAll] = useState(false);

    const [exportingFiltered, setExportingFiltered] = useState(false);
    const [filteredCount, setFilteredCount] = useState(0);

    const [showFreezeModal, setShowFreezeModal] = useState(false);
    const [freezeReason, setFreezeReason] = useState('');
    const [freezeDuration, setFreezeDuration] = useState(7);
    const [freezingCertId, setFreezingCertId] = useState<string | null>(null);

    const [showRevokeModal, setShowRevokeModal] = useState(false);
    const [revokeReason, setRevokeReason] = useState('');
    const [revokingCertIds, setRevokingCertIds] = useState<string[]>([]);

    const [showTransferModal, setShowTransferModal] = useState(false);
    const [transferData, setTransferData] = useState({
        certificateId: '',
        newOwnerEmail: '',
        newOwnerName: '',
        reason: ''
    });

    const [showHistoryModal, setShowHistoryModal] = useState(false);
    const [, setSelectedCertId] = useState<string | null>(null);
    const [certHistory, setCertHistory] = useState<ActivityItem[]>([]);
    const [loadingHistory, setLoadingHistory] = useState(false);

    const [viewingCertificate, setViewingCertificate] = useState<Certificate | null>(null);

    const fetchCertificates = useCallback(async () => {
        setLoading(true);
        try {
            const params = {
                page,
                limit,
                search: debouncedSearch || undefined,
                status: statusFilter || undefined,
                sortBy,
                sortOrder,
                startDate: startDate || undefined,
                endDate: endDate || undefined,
            };

            const response = await certificateApi.list(params);
            setCertificates(response.data);
            setTotal(response.total);
            setTotalPages(response.totalPages);
            setFilteredCount(response.total);
        } catch (err) {
            console.error('Failed to fetch certificates:', err);
            onError?.('Failed to fetch certificates');
        } finally {
            setLoading(false);
        }
    }, [page, limit, debouncedSearch, statusFilter, sortBy, sortOrder, startDate, endDate, onError]);

    useEffect(() => {
        fetchCertificates();
    }, [fetchCertificates]);

    const handleSort = (field: SortField) => {
        if (sortBy === field) {
            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        } else {
            setSortBy(field);
            setSortOrder('asc');
        }
    };

    const handleSelectAll = () => {
        if (selectAll) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(certificates.map(c => c.id)));
        }
        setSelectAll(!selectAll);
    };

    const handleSelect = (id: string) => {
        const newSelected = new Set(selectedIds);
        if (newSelected.has(id)) {
            newSelected.delete(id);
        } else {
            newSelected.add(id);
        }
        setSelectedIds(newSelected);
        setSelectAll(newSelected.size === certificates.length);
    };

    const handleBulkExport = async () => {
        try {
            const filters: CertificateExportFilters = {
                search: search || undefined,
                status: statusFilter || undefined,
                startDate: startDate || undefined,
                endDate: endDate || undefined,
            };
            const blob = await certificateApi.bulkExport(Array.from(selectedIds), filters);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `certificates-export-${new Date().toISOString().split('T')[0]}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            onSuccess?.('Certificates exported successfully');
        } catch (err) {
            console.error('Export failed:', err);
            onError?.('Failed to export certificates');
        }
    };

    const handleBulkExportAll = async () => {
        setExportingFiltered(true);
        try {
            const filters: CertificateExportFilters = {
                search: search || undefined,
                status: statusFilter || undefined,
                startDate: startDate || undefined,
                endDate: endDate || undefined,
            };
            const blob = await certificateApi.bulkExportAll(filters);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `certificates-export-all-${new Date().toISOString().split('T')[0]}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            onSuccess?.(`Successfully exported ${filteredCount} certificates`);
        } catch (err) {
            console.error('Export failed:', err);
            onError?.('Failed to export certificates');
        } finally {
            setExportingFiltered(false);
        }
    };

    const handleBulkRevoke = () => {
        setRevokingCertIds(Array.from(selectedIds));
        setShowRevokeModal(true);
    };

    const closeRevokeModal = () => {
        setShowRevokeModal(false);
        setRevokeReason('');
        setRevokingCertIds([]);
    };

    const confirmRevoke = async () => {
        try {
            await certificateApi.bulkRevoke(revokingCertIds, revokeReason);
            onSuccess?.('Certificates revoked successfully');
            setShowRevokeModal(false);
            setRevokeReason('');
            setSelectedIds(new Set());
            setSelectAll(false);
            fetchCertificates();
        } catch (err) {
            console.error('Revoke failed:', err);
            onError?.('Failed to revoke certificates');
        }
    };

    const handleFreeze = (certId: string) => {
        setFreezingCertId(certId);
        setShowFreezeModal(true);
    };

    const closeFreezeModal = () => {
        setShowFreezeModal(false);
        setFreezeReason('');
        setFreezingCertId(null);
    };

    const confirmFreeze = async () => {
        if (!freezingCertId) return;
        try {
            const durationDays = Math.max(1, Number.isFinite(freezeDuration) ? Math.trunc(freezeDuration) : 1);
            await certificateApi.freeze(freezingCertId, freezeReason, durationDays);
            onSuccess?.('Certificate frozen successfully');
            setShowFreezeModal(false);
            setFreezeReason('');
            setFreezeDuration(7);
            setFreezingCertId(null);
            fetchCertificates();
        } catch (err) {
            console.error('Freeze failed:', err);
            onError?.('Failed to freeze certificate');
        }
    };

    const handleUnfreeze = async (certId: string) => {
        try {
            await certificateApi.unfreeze(certId);
            onSuccess?.('Certificate unfrozen successfully');
            fetchCertificates();
        } catch (err) {
            console.error('Unfreeze failed:', err);
            onError?.('Failed to unfreeze certificate');
        }
    };

    const handleTransfer = (cert: Certificate) => {
        setTransferData({
            certificateId: cert.id,
            newOwnerEmail: '',
            newOwnerName: '',
            reason: ''
        });
        setShowTransferModal(true);
    };

    const confirmTransfer = async () => {
        try {
            await certificateApi.transfer.initiate(transferData);
            onSuccess?.('Transfer initiated successfully. New owner must approve.');
            setShowTransferModal(false);
            fetchCertificates();
        } catch (err) {
            console.error('Transfer failed:', err);
            onError?.('Failed to initiate transfer');
        }
    };

    const handleViewHistory = async (certId: string) => {
        setSelectedCertId(certId);
        setShowHistoryModal(true);
        setLoadingHistory(true);
        try {
            const history = await auditApi.getCertificateHistory(certId);
            setCertHistory(history);
        } catch (err) {
            console.error('Failed to fetch history:', err);
            onError?.('Failed to load certificate history');
        } finally {
            setLoadingHistory(false);
        }
    };

    const getStatusBadge = (status: string) => {
        const baseClasses = 'px-2 py-1 rounded-full text-xs font-medium';
        switch (status) {
            case 'active':
                return <span className={`${baseClasses} bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200`}>Active</span>;
            case 'revoked':
                return <span className={`${baseClasses} bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200`}>Revoked</span>;
            case 'expired':
                return <span className={`${baseClasses} bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300`}>Expired</span>;
            case 'frozen':
                return <span className={`${baseClasses} bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200`}>Frozen</span>;
            default:
                return <span className={`${baseClasses} bg-gray-100 text-gray-800`}>{status}</span>;
        }
    };

    const SortIcon = ({ field }: { field: SortField }) => {
        if (sortBy !== field) return null;
        return sortOrder === 'asc' ? <ChevronUp className="w-4 h-4 ml-1" /> : <ChevronDown className="w-4 h-4 ml-1" />;
    };

    const clearFilters = () => {
        setSearch('');
        setStatusFilter('');
        setStartDate('');
        setEndDate('');
        setPage(1);
    };

    const hasActiveFilters = search || statusFilter || startDate || endDate;

    const ExportButton = () => (
        <button
            onClick={handleBulkExport}
            disabled={selectedIds.size === 0}
            className="inline-flex items-center px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-slate-800 dark:text-gray-200 dark:border-slate-600 dark:hover:bg-slate-700"
        >
            <Download className="w-4 h-4 mr-2" />
            Export ({selectedIds.size})
        </button>
    );

    const ExportAllButton = () => (
        <button
            onClick={handleBulkExportAll}
            disabled={exportingFiltered || filteredCount === 0}
            className="inline-flex items-center px-3 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-300 rounded-md hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-600 dark:hover:bg-blue-900/30"
        >
            <Download className="w-4 h-4 mr-2" />
            {exportingFiltered ? 'Exporting...' : `Export All (${filteredCount})`}
        </button>
    );

    const RevokeButton = () => (
        <button
            onClick={handleBulkRevoke}
            disabled={selectedIds.size === 0}
            className="inline-flex items-center px-3 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
            <XCircle className="w-4 h-4 mr-2" />
            Revoke ({selectedIds.size})
        </button>
    );

    return (
        <div className="space-y-4">
            <div className="bg-white dark:bg-slate-900 p-4 rounded-lg shadow-md dark:shadow-lg dark:border dark:border-slate-700">
                <div className="flex flex-col lg:flex-row gap-4">
                    <div className="flex-1 relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                        <input
                            type="text"
                            placeholder="Search by recipient, ID, or issuer..."
                            value={search}
                            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-slate-800 dark:border-slate-600 dark:text-white"
                        />
                    </div>

                    <select
                        value={statusFilter}
                        onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
                        className="px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-slate-800 dark:border-slate-600 dark:text-white"
                    >
                        <option value="">All Statuses</option>
                        <option value="active">Active</option>
                        <option value="revoked">Revoked</option>
                        <option value="expired">Expired</option>
                        <option value="frozen">Frozen</option>
                    </select>

                    <div className="flex gap-2">
                        <input
                            type="date"
                            value={startDate}
                            onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
                            className="px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-slate-800 dark:border-slate-600 dark:text-white"
                            placeholder="Start Date"
                        />
                        <input
                            type="date"
                            value={endDate}
                            onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
                            className="px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-slate-800 dark:border-slate-600 dark:text-white"
                            placeholder="End Date"
                        />
                    </div>

                    {hasActiveFilters && (
                        <button
                            onClick={clearFilters}
                            className="inline-flex items-center px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 dark:text-gray-300 dark:hover:text-white"
                        >
                            <X className="w-4 h-4 mr-1" />
                            Clear
                        </button>
                    )}
                </div>

                <div className="flex gap-2 mt-4">
                    <ExportButton />
                    <ExportAllButton />
                    <RevokeButton />
                </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-lg shadow-md dark:shadow-lg dark:border dark:border-slate-700 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                        <thead className="bg-gray-50 dark:bg-slate-800">
                            <tr>
                                <th className="px-6 py-3 text-left">
                                    <input
                                        type="checkbox"
                                        checked={selectAll}
                                        onChange={handleSelectAll}
                                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                    />
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700" onClick={() => handleSort('serialNumber')}>
                                    <div className="flex items-center">Certificate ID<SortIcon field="serialNumber" /></div>
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700" onClick={() => handleSort('recipientName')}>
                                    <div className="flex items-center">Recipient<SortIcon field="recipientName" /></div>
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700" onClick={() => handleSort('title')}>
                                    <div className="flex items-center">Title<SortIcon field="title" /></div>
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700" onClick={() => handleSort('issuerName')}>
                                    <div className="flex items-center">Issuer<SortIcon field="issuerName" /></div>
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700" onClick={() => handleSort('issueDate')}>
                                    <div className="flex items-center">Issue Date<SortIcon field="issueDate" /></div>
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700" onClick={() => handleSort('status')}>
                                    <div className="flex items-center">Status<SortIcon field="status" /></div>
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-slate-900 divide-y divide-gray-200 dark:divide-slate-700">
                            {loading ? (
                                <tr>
                                    <td colSpan={8} className="px-6 py-12 text-center text-gray-500 dark:text-slate-400">
                                        <div className="flex justify-center items-center">
                                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                                            <span className="ml-3">Loading certificates...</span>
                                        </div>
                                    </td>
                                </tr>
                            ) : certificates.length === 0 ? (
                                <tr>
                                    <td colSpan={8} className="px-6 py-12 text-center text-gray-500 dark:text-slate-400">No certificates found</td>
                                </tr>
                            ) : (
                                certificates.map((cert) => (
                                    <tr key={cert.id} className="hover:bg-gray-50 dark:hover:bg-slate-800">
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <input type="checkbox" checked={selectedIds.has(cert.id)} onChange={() => handleSelect(cert.id)} className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-900 dark:text-white">{cert.serialNumber}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">{cert.recipientName}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">{cert.title}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">{cert.issuerName}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">{new Date(cert.issueDate).toLocaleDateString()}</td>
                                        <td className="px-6 py-4 whitespace-nowrap">{getStatusBadge(cert.status)}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                                            <div className="flex gap-2">
                                                <button onClick={() => handleFreeze(cert.id)} className="p-1 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300" title="Freeze Certificate" disabled={cert.status === 'frozen' || cert.status === 'revoked'}>
                                                    <Snowflake className="w-5 h-5" />
                                                </button>
                                                {cert.status === 'frozen' && (
                                                    <button onClick={() => handleUnfreeze(cert.id)} className="p-1 text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-300" title="Unfreeze Certificate">
                                                        <Check className="w-5 h-5" />
                                                    </button>
                                                )}
                                                <button onClick={() => { setRevokingCertIds([cert.id]); setShowRevokeModal(true); }} className="p-1 text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300" title="Revoke Certificate" disabled={cert.status === 'revoked'}>
                                                    <XCircle className="w-5 h-5" />
                                                </button>
                                                <button onClick={() => handleTransfer(cert)} className="p-1 text-purple-600 hover:text-purple-800 dark:text-purple-400 dark:hover:text-purple-300" title="Transfer Certificate" disabled={cert.status !== 'active'}>
                                                    <Send className="w-5 h-5" />
                                                </button>
                                                <button onClick={() => handleViewHistory(cert.id)} className="p-1 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300" title="View History">
                                                    <History className="w-5 h-5" />
                                                </button>
                                                <button type="button" onClick={() => setViewingCertificate(cert)} className="p-1 text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-300" title="View Certificate" aria-label={`View certificate ${cert.serialNumber}`}>
                                                    <FileText className="w-5 h-5" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                <div className="px-6 py-4 flex items-center justify-between border-t border-gray-200 dark:border-slate-700">
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-500 dark:text-slate-400">Showing {(page - 1) * limit + 1} to {Math.min(page * limit, total)} of {total} results</span>
                        <select value={limit} onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }} className="ml-2 px-2 py-1 text-sm border border-gray-300 rounded-md dark:bg-slate-800 dark:border-slate-600 dark:text-white">
                            <option value={10}>10</option>
                            <option value={25}>25</option>
                            <option value={50}>50</option>
                            <option value={100}>100</option>
                        </select>
                    </div>
                    <div className="flex gap-2">
                        <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="p-2 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed dark:border-slate-600 dark:hover:bg-slate-700">
                            <ChevronLeft className="w-5 h-5" />
                        </button>
                        <span className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300">Page {page} of {totalPages}</span>
                        <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="p-2 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed dark:border-slate-600 dark:hover:bg-slate-700">
                            <ChevronRight className="w-5 h-5" />
                        </button>
                    </div>
                </div>
            </div>

            <Modal isOpen={showFreezeModal} onClose={closeFreezeModal} labelledBy="freeze-certificate-title" wrapperClassName="fixed inset-0 z-50 flex items-center justify-center" overlayClassName="absolute inset-0 bg-black/50" dialogClassName="relative bg-white dark:bg-slate-900 rounded-lg p-6 max-w-md w-full mx-4">
                <div className="flex items-center gap-2 mb-4">
                    <Snowflake className="w-6 h-6 text-blue-600" />
                    <h3 id="freeze-certificate-title" className="text-lg font-semibold dark:text-white">Freeze Certificate</h3>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">This will temporarily freeze the certificate during a dispute. You can unfreeze it at any time.</p>
                <div className="space-y-4">
                    <div>
                        <label htmlFor="freeze-reason" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Reason for freezing</label>
                        <textarea id="freeze-reason" value={freezeReason} onChange={(e) => setFreezeReason(e.target.value)} rows={3} className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 dark:bg-slate-800 dark:border-slate-600 dark:text-white" placeholder="Enter the reason for freezing..." />
                    </div>
                    <div>
                        <label htmlFor="freeze-duration" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Freeze Duration (days)</label>
                        <input id="freeze-duration" type="number" min={1} max={90} value={freezeDuration} onChange={(e) => setFreezeDuration(Number(e.target.value))} className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 dark:bg-slate-800 dark:border-slate-600 dark:text-white" />
                        <p className="text-xs text-gray-500 mt-1">Maximum 90 days. Leave empty for indefinite.</p>
                    </div>
                </div>
                <div className="flex gap-3 mt-6">
                    <button type="button" onClick={closeFreezeModal} className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-300 dark:hover:bg-slate-700">Cancel</button>
                    <button type="button" onClick={confirmFreeze} disabled={!freezeReason} className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50">Freeze</button>
                </div>
            </Modal>

            <Modal isOpen={showRevokeModal} onClose={closeRevokeModal} labelledBy="revoke-certificate-title" wrapperClassName="fixed inset-0 z-50 flex items-center justify-center" overlayClassName="absolute inset-0 bg-black/50" dialogClassName="relative bg-white dark:bg-slate-900 rounded-lg p-6 max-w-md w-full mx-4">
                <div className="flex items-center gap-2 mb-4">
                    <AlertTriangle className="w-6 h-6 text-red-600" />
                    <h3 id="revoke-certificate-title" className="text-lg font-semibold dark:text-white">Revoke Certificate{revokingCertIds.length > 1 ? 's' : ''}</h3>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">Are you sure you want to revoke {revokingCertIds.length} certificate{revokingCertIds.length > 1 ? 's' : ''}? This action cannot be undone.</p>
                <div>
                    <label htmlFor="revoke-reason" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Reason for revocation</label>
                    <textarea id="revoke-reason" value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} rows={3} className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-red-500 dark:bg-slate-800 dark:border-slate-600 dark:text-white" placeholder="Enter the reason for revocation..." />
                </div>
                <div className="flex gap-3 mt-6">
                    <button type="button" onClick={closeRevokeModal} className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-300 dark:hover:bg-slate-700">Cancel</button>
                    <button type="button" onClick={confirmRevoke} className="flex-1 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700">Revoke</button>
                </div>
            </Modal>

            <Modal isOpen={showTransferModal} onClose={() => setShowTransferModal(false)} labelledBy="transfer-certificate-title" wrapperClassName="fixed inset-0 z-50 flex items-center justify-center" overlayClassName="absolute inset-0 bg-black/50" dialogClassName="relative bg-white dark:bg-slate-900 rounded-lg p-6 max-w-md w-full mx-4">
                <div className="flex items-center gap-2 mb-4">
                    <Send className="w-6 h-6 text-purple-600" />
                    <h3 id="transfer-certificate-title" className="text-lg font-semibold dark:text-white">Initiate Transfer</h3>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">Transfer ownership of this certificate to a new recipient. The new owner will need to approve the transfer.</p>
                <div className="space-y-4">
                    <div>
                        <label htmlFor="transfer-owner-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">New Owner Name</label>
                        <input id="transfer-owner-name" type="text" value={transferData.newOwnerName} onChange={(e) => setTransferData({ ...transferData, newOwnerName: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 dark:bg-slate-800 dark:border-slate-600 dark:text-white" placeholder="Recipient's full name" required />
                    </div>
                    <div>
                        <label htmlFor="transfer-owner-email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">New Owner Email</label>
                        <input id="transfer-owner-email" type="email" value={transferData.newOwnerEmail} onChange={(e) => setTransferData({ ...transferData, newOwnerEmail: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 dark:bg-slate-800 dark:border-slate-600 dark:text-white" placeholder="recipient@example.com" required />
                    </div>
                    <div>
                        <label htmlFor="transfer-reason" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Reason (Optional)</label>
                        <textarea id="transfer-reason" value={transferData.reason} onChange={(e) => setTransferData({ ...transferData, reason: e.target.value })} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 dark:bg-slate-800 dark:border-slate-600 dark:text-white" placeholder="e.g., Correction of name, change of ownership..." />
                    </div>
                </div>
                <div className="flex gap-3 mt-6">
                    <button type="button" onClick={() => setShowTransferModal(false)} className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-300 dark:hover:bg-slate-700">Cancel</button>
                    <button type="button" onClick={confirmTransfer} disabled={!transferData.newOwnerEmail || !transferData.newOwnerName} className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50">Initiate Transfer</button>
                </div>
            </Modal>

            <Modal isOpen={showHistoryModal} onClose={() => setShowHistoryModal(false)} labelledBy="certificate-history-title" wrapperClassName="fixed inset-0 z-50 flex items-center justify-center" overlayClassName="absolute inset-0 bg-black/50" dialogClassName="relative bg-white dark:bg-slate-900 rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-2">
                        <History className="w-6 h-6 text-blue-600" />
                        <h3 id="certificate-history-title" className="text-lg font-semibold dark:text-white">Certificate History</h3>
                    </div>
                    <button type="button" onClick={() => setShowHistoryModal(false)} className="text-gray-500 hover:text-gray-700 dark:text-gray-400" aria-label="Close certificate history">
                        <XCircle className="w-6 h-6" />
                    </button>
                </div>

                {loadingHistory ? (
                    <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div></div>
                ) : certHistory.length === 0 ? (
                    <p className="text-center py-8 text-gray-500 dark:text-gray-400">No history found for this certificate.</p>
                ) : (
                    <div className="space-y-6">
                        {certHistory.map((item, index) => (
                            <div key={index} className="flex gap-4">
                                <div className="flex flex-col items-center">
                                    <div className="w-3 h-3 bg-blue-600 rounded-full mt-1.5"></div>
                                    {index !== certHistory.length - 1 && <div className="w-0.5 h-full bg-gray-200 dark:bg-slate-700 my-1"></div>}
                                </div>
                                <div>
                                    <p className="text-sm font-medium dark:text-white capitalize">{item.type.replace('_', ' ')}</p>
                                    <p className="text-sm text-gray-600 dark:text-gray-400">{item.description}</p>
                                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{new Date(item.date).toLocaleString()}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                <div className="mt-8">
                    <button type="button" onClick={() => setShowHistoryModal(false)} className="w-full px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-md dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-white">Close</button>
                </div>
            </Modal>

            {viewingCertificate && (
                <Modal isOpen onClose={() => setViewingCertificate(null)} labelledBy="certificate-details-title" wrapperClassName="fixed inset-0 z-50 flex items-center justify-center" overlayClassName="absolute inset-0 bg-black/50" dialogClassName="relative bg-white dark:bg-slate-900 rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-2">
                            <FileText className="w-6 h-6 text-gray-600 dark:text-gray-300" />
                            <h3 id="certificate-details-title" className="text-lg font-semibold dark:text-white">Certificate Details</h3>
                        </div>
                        <button type="button" onClick={() => setViewingCertificate(null)} className="text-gray-500 hover:text-gray-700 dark:text-gray-400" aria-label="Close certificate details">
                            <XCircle className="w-6 h-6" />
                        </button>
                    </div>

                    <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div><dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">Serial Number</dt><dd className="mt-1 font-mono text-sm text-gray-900 dark:text-white break-all">{viewingCertificate.serialNumber}</dd></div>
                        <div><dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">Status</dt><dd className="mt-1">{getStatusBadge(viewingCertificate.status)}</dd></div>
                        <div><dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">Recipient</dt><dd className="mt-1 text-sm text-gray-900 dark:text-white">{viewingCertificate.recipientName}{viewingCertificate.recipientEmail && <span className="block text-xs text-gray-500 dark:text-slate-400">{viewingCertificate.recipientEmail}</span>}</dd></div>
                        <div><dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">Issuer</dt><dd className="mt-1 text-sm text-gray-900 dark:text-white">{viewingCertificate.issuerName}</dd></div>
                        <div><dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">Title</dt><dd className="mt-1 text-sm text-gray-900 dark:text-white">{viewingCertificate.title}</dd></div>
                        <div><dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">Course</dt><dd className="mt-1 text-sm text-gray-900 dark:text-white">{viewingCertificate.courseName || '—'}</dd></div>
                        <div><dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">Issued</dt><dd className="mt-1 text-sm text-gray-900 dark:text-white">{new Date(viewingCertificate.issueDate).toLocaleDateString()}</dd></div>
                        <div><dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">Expires</dt><dd className="mt-1 text-sm text-gray-900 dark:text-white">{viewingCertificate.expiryDate ? new Date(viewingCertificate.expiryDate).toLocaleDateString() : 'No expiry'}</dd></div>
                        {viewingCertificate.status === 'frozen' && viewingCertificate.freezeReason && <div className="sm:col-span-2"><dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">Freeze Reason</dt><dd className="mt-1 text-sm text-gray-900 dark:text-white">{viewingCertificate.freezeReason}</dd></div>}
                        {viewingCertificate.txHash && <div className="sm:col-span-2"><dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">Transaction Hash</dt><dd className="mt-1 font-mono text-xs text-gray-900 dark:text-white break-all">{viewingCertificate.txHash}</dd></div>}
                        {viewingCertificate.cid && <div className="sm:col-span-2"><dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">IPFS CID</dt><dd className="mt-1 font-mono text-xs text-gray-900 dark:text-white break-all">{viewingCertificate.cid}</dd></div>}
                    </dl>

                    <div className="flex gap-3 mt-6">
                        {viewingCertificate.pdfUrl && <a href={viewingCertificate.pdfUrl} target="_blank" rel="noopener noreferrer" className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-center">Open Certificate File</a>}
                        <button type="button" onClick={() => setViewingCertificate(null)} className="flex-1 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-md dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-white">Close</button>
                    </div>
                </Modal>
            )}
        </div>
    );
};

export default CertificateTable;
