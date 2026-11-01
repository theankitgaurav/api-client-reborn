# Variable Resolution Inspector Example

Open **Variable Resolution - Collection Override** and hover over `{{scope_probe}}` in the request editor. This collection defines `scope_probe` as `from-collection`.

To verify precedence, add a selected-environment variable with the same name and value `from-environment`, then hover over the token again. The request should resolve to `from-collection`, and the inspector should identify the collection as the winning source. The response from httpbin echoes the resolved query parameters so you can compare the inspector with what was sent.

For a secret display check, add a workspace secret named `secret_probe` with a throwaway value such as `dummy-secret-for-inspector-check`; do not use a real credential. Hover over `{{secret_probe}}` and check that the inspector identifies it as a secret without displaying the value. This request sends that dummy value to httpbin as part of the query string.

The request and collection variables are included automatically with the example collection. Environment and workspace values are local to each user's workspace, so they are provided as manual setup steps instead of being committed.
