// Shows a success or error message passed in the page address (?msg=... or ?error=...).
export default function Notice({ sp }) {
  if (sp?.error) return <p className="notice error" role="alert">{sp.error}</p>;
  if (sp?.msg) return <p className="notice ok" role="status">{sp.msg}</p>;
  return null;
}
