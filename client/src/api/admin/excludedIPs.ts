import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export interface ExcludedIPsResponse {
  success: boolean;
  excludedIPs: string[];
  error?: string;
}

export interface UpdateExcludedIPsRequest {
  siteId: number;
  excludedIPs: string[];
}

export interface UpdateExcludedIPsResponse {
  success: boolean;
  message: string;
  excludedIPs: string[];
  error?: string;
  details?: string[];
}

// Fetch excluded IPs for a site
export const fetchExcludedIPs = async (siteId: string): Promise<ExcludedIPsResponse> => {
  const response = await fetch(`/api/site/${siteId}/excluded-ips`, {
    credentials: "include",
  });

  if (!response.ok) {
    let errorMessage = "Failed to fetch excluded IPs";
    try {
      const errorData = await response.json();
      errorMessage = errorData.error || errorMessage;
    } catch {
      // If JSON parsing fails, use the default error message
    }
    throw new Error(errorMessage);
  }

  return response.json();
};

// Update excluded IPs for a site
export const updateExcludedIPs = async (
  siteId: number,
  excludedIPs: string[]
): Promise<UpdateExcludedIPsResponse> => {
  const response = await fetch(`/api/site/${siteId}/excluded-ips`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({
      siteId: siteId.toString(),
      excludedIPs,
    }),
  });

  if (!response.ok) {
    let errorMessage = "Failed to update excluded IPs";
    try {
      const errorData = await response.json();
      errorMessage = errorData.error || errorMessage;
    } catch {
      // If JSON parsing fails, use the default error message
    }
    throw new Error(errorMessage);
  }

  return response.json();
};

// Hook to fetch excluded IPs
export const useGetExcludedIPs = (siteId: number) => {
  return useQuery({
    queryKey: ["excludedIPs", siteId],
    queryFn: () => fetchExcludedIPs(siteId.toString()),
    enabled: !!siteId,
  });
};

// Hook to update excluded IPs
export const useUpdateExcludedIPs = () => {
  const queryClient = useQueryClient();

  return useMutation<UpdateExcludedIPsResponse, Error, UpdateExcludedIPsRequest>({
    mutationFn: ({ siteId, excludedIPs }: UpdateExcludedIPsRequest) =>
      updateExcludedIPs(siteId, excludedIPs),
    onSuccess: (_: UpdateExcludedIPsResponse, variables: UpdateExcludedIPsRequest) => {
      toast.success("Excluded IPs updated successfully");
      // Invalidate and refetch excluded IPs data
      queryClient.invalidateQueries({
        queryKey: ["excludedIPs", variables.siteId],
      });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update excluded IPs");
    },
  });
};