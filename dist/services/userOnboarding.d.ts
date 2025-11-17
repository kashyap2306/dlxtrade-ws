/**
 * Idempotent user onboarding service
 * Creates ALL required Firestore documents when user signs up/logs in
 * Can be called multiple times safely - only creates missing documents/fields
 */
export interface UserOnboardingResult {
    success: boolean;
    createdNew: boolean;
    uid: string;
    error?: string;
}
export declare function ensureUser(uid: string, profileData?: {
    name?: string;
    email?: string;
    phone?: string | null;
}): Promise<UserOnboardingResult>;
export declare function onboardNewUser(uid: string, userData: {
    name?: string;
    email?: string;
    phone?: string | null;
}): Promise<void>;
//# sourceMappingURL=userOnboarding.d.ts.map