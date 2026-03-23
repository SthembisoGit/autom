import type {
  CallToActionStyle,
  ContentProfile,
  DashboardSummary,
  GenerationJob,
  JobDetailResponse,
  JobMonitorResponse,
  Platform,
  PlatformConnection,
  SchedulerOverview,
  UpsertProfileRequest,
} from '@autom/contracts';

const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL ?? 'http://localhost:4010';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: unknown };
    throw new Error(typeof payload.message === 'string' ? payload.message : 'Request failed.');
  }

  return (await response.json()) as T;
}

export const apiClient = {
  getProfileSchema(): Promise<{
    required: string[];
    optional: string[];
    availableTargetPlatforms: Platform[];
  }> {
    return request('/profiles/schema');
  },
  getDashboard(): Promise<DashboardSummary> {
    return request('/dashboard');
  },
  getSchedulerOverview(): Promise<SchedulerOverview> {
    return request('/scheduler');
  },
  runSchedulerNow(): Promise<SchedulerOverview> {
    return request('/scheduler/run', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },
  listProfiles(): Promise<ContentProfile[]> {
    return request('/profiles');
  },
  upsertProfile(profileId: string, payload: UpsertProfileRequest): Promise<ContentProfile> {
    return request(`/profiles/${profileId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },
  listReviews(): Promise<GenerationJob[]> {
    return request('/reviews');
  },
  getJob(jobId: string): Promise<JobDetailResponse> {
    return request(`/jobs/${jobId}`);
  },
  retryJob(jobId: string): Promise<GenerationJob> {
    return request(`/jobs/${jobId}/retry`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },
  getJobMonitor(): Promise<JobMonitorResponse> {
    return request('/jobs/monitor');
  },
  approveReview(jobId: string, note?: string): Promise<GenerationJob> {
    return request(`/reviews/${jobId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    });
  },
  rejectReview(jobId: string, note?: string): Promise<GenerationJob> {
    return request(`/reviews/${jobId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    });
  },
  listHistory(): Promise<GenerationJob[]> {
    return request('/history');
  },
  getRenderArtifactUrl(jobId: string, artifact: 'video' | 'subtitles' | 'thumbnail'): string {
    return `${API_BASE_URL}/jobs/${jobId}/artifacts/render/${artifact}`;
  },
  getLocalPublicationArtifactUrl(
    jobId: string,
    artifact: 'video' | 'thumbnail' | 'manifest'
  ): string {
    return `${API_BASE_URL}/jobs/${jobId}/artifacts/publications/local/${artifact}`;
  },
  listConnections(): Promise<PlatformConnection[]> {
    return request('/publications/connections');
  },
  getConnectionStartUrl(platform: Platform): string {
    return `${API_BASE_URL}/publications/connections/${platform}/start`;
  },
  disconnectConnection(platform: Platform): Promise<PlatformConnection> {
    return request(`/publications/connections/${platform}`, {
      method: 'DELETE',
    });
  },
  publishJob(jobId: string): Promise<GenerationJob> {
    return request(`/publications/${jobId}/publish`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },
};

export const callToActionStyleOptions: Array<{
  value: CallToActionStyle;
  label: string;
}> = [
  { value: 'community', label: 'Community' },
  { value: 'educational', label: 'Educational' },
  { value: 'affiliate', label: 'Affiliate' },
];
