/**
 * Client-side IP validation utility
 * This should match the server-side validation logic in server/src/lib/ipUtils.ts
 */

export interface IPValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate if an IP pattern is valid
 * Supports:
 * - Single IPv4: 192.168.1.1
 * - Single IPv6: 2001:db8::1
 * - IPv6 shorthand: ::1, 2001::1
 * - CIDR notation: 192.168.1.0/24, 2001:db8::/32
 * - Range notation: 192.168.1.1-192.168.1.10
 */
export function validateIPPattern(pattern: string): IPValidationResult {
  try {
    const trimmedPattern = pattern.trim();
    
    if (!trimmedPattern) {
      return { valid: true }; // Empty is valid (will be filtered out)
    }
    
    // Single IP
    if (!trimmedPattern.includes("/") && !trimmedPattern.includes("-")) {
      return validateSingleIP(trimmedPattern);
    }

    // CIDR notation
    if (trimmedPattern.includes("/")) {
      return validateCIDR(trimmedPattern);
    }

    // Range notation
    if (trimmedPattern.includes("-")) {
      return validateRange(trimmedPattern);
    }

    return { valid: false, error: "Unknown IP pattern format" };
  } catch (error) {
    return { valid: false, error: `Validation error: ${error}` };
  }
}

/**
 * Validate a single IP address (IPv4 or IPv6)
 */
function validateSingleIP(ip: string): IPValidationResult {
  // IPv4 validation
  if (isValidIPv4(ip)) {
    return { valid: true };
  }

  // IPv6 validation
  if (isValidIPv6(ip)) {
    return { valid: true };
  }

  return { valid: false, error: "Invalid IP address format" };
}

/**
 * Validate CIDR notation
 */
function validateCIDR(cidr: string): IPValidationResult {
  const parts = cidr.split("/");
  if (parts.length !== 2) {
    return { valid: false, error: "Invalid CIDR format" };
  }

  const [ip, prefixStr] = parts;
  const prefix = parseInt(prefixStr, 10);

  if (isNaN(prefix)) {
    return { valid: false, error: "Invalid CIDR prefix" };
  }

  // Check if it's IPv4 CIDR
  if (isValidIPv4(ip)) {
    if (prefix < 0 || prefix > 32) {
      return { valid: false, error: "IPv4 CIDR prefix must be between 0 and 32" };
    }
    return { valid: true };
  }

  // Check if it's IPv6 CIDR
  if (isValidIPv6(ip)) {
    if (prefix < 0 || prefix > 128) {
      return { valid: false, error: "IPv6 CIDR prefix must be between 0 and 128" };
    }
    return { valid: true };
  }

  return { valid: false, error: "Invalid IP address in CIDR notation" };
}

/**
 * Validate range notation (IPv4 only)
 * 
 * NOTE: Range notation is only supported for IPv4 addresses.
 * IPv6 range notation is not supported due to the complexity of proper
 * numerical comparison of 128-bit addresses. Use CIDR notation instead
 * for IPv6 (e.g., 2001:db8::/32).
 */
function validateRange(range: string): IPValidationResult {
  const parts = range.split("-").map(ip => ip.trim());
  if (parts.length !== 2) {
    return { valid: false, error: "Invalid range format" };
  }

  const [startIP, endIP] = parts;

  if (!startIP || !endIP) {
    return { valid: false, error: "Invalid range format" };
  }

  // Check if both are IPv4 addresses
  const startIsIPv4 = isValidIPv4(startIP);
  const endIsIPv4 = isValidIPv4(endIP);

  if (startIsIPv4 && endIsIPv4) {
    return { valid: true };
  }

  // Check if these are IPv6 addresses to provide a better error message
  const startIsIPv6 = isValidIPv6(startIP);
  const endIsIPv6 = isValidIPv6(endIP);

  if (startIsIPv6 && endIsIPv6) {
    return { 
      valid: false, 
      error: "IPv6 range notation not supported. Use CIDR notation instead (e.g., 2001:db8::/32)" 
    };
  }

  return { valid: false, error: "Range IPs must be valid IPv4 addresses" };
}

/**
 * Check if string is a valid IPv4 address
 */
function isValidIPv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;

  return parts.every(part => {
    const num = parseInt(part, 10);
    return !isNaN(num) && num >= 0 && num <= 255 && part === num.toString();
  });
}

/**
 * Check if string is a valid IPv6 address
 * Supports full notation, compressed notation (::), and mixed notation
 */
function isValidIPv6(ip: string): boolean {
  // Basic IPv6 pattern check
  const ipv6Pattern = /^([0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{1,4}$|^([0-9a-fA-F]{1,4}:)*::([0-9a-fA-F]{1,4}:)*[0-9a-fA-F]{1,4}$|^::1$|^::$/;
  
  if (!ipv6Pattern.test(ip)) {
    return false;
  }

  // More detailed validation
  const parts = ip.split(":");
  
  // Handle compressed notation
  if (ip.includes("::")) {
    const doublColonCount = (ip.match(/::/g) || []).length;
    if (doublColonCount > 1) return false; // Only one :: allowed
    
    // Special cases
    if (ip === "::") return true;
    if (ip === "::1") return true;
    
    // Calculate total parts after expansion
    const beforeDoubleColon = ip.split("::")[0];
    const afterDoubleColon = ip.split("::")[1];
    const beforeParts = beforeDoubleColon ? beforeDoubleColon.split(":").length : 0;
    const afterParts = afterDoubleColon ? afterDoubleColon.split(":").length : 0;
    
    // For compressed notation, the sum must be < 8 to ensure at least one zero group is replaced
    return (beforeParts + afterParts) < 8;
  }
  
  // Full notation
  if (parts.length !== 8) return false;
  
  return parts.every(part => {
    if (part.length === 0 || part.length > 4) return false;
    return /^[0-9a-fA-F]+$/.test(part);
  });
}