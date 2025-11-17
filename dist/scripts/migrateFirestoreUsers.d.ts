/**
 * Firestore User Migration Script
 *
 * Scans users collection, creates missing documents with exact schema,
 * and removes demo/test placeholder documents.
 */
declare function migrateFirestoreUsers(): Promise<{
    total: number;
    fixed: number;
    errors: number;
    demoRemoved: number;
    success: boolean;
}>;
export { migrateFirestoreUsers };
//# sourceMappingURL=migrateFirestoreUsers.d.ts.map