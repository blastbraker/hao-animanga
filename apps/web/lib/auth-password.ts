export function passwordValidation(password: string, confirmation: string): string | null {
  if (password.length < 10) return "Use at least 10 characters.";
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) return "Include an uppercase letter, lowercase letter, and number.";
  if (password !== confirmation) return "The passwords do not match.";
  return null;
}
