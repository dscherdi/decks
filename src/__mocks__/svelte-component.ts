// Mock for Svelte components in unit tests
export default class MockSvelteComponent {
  constructor(options: any) {
    // Mock Svelte component constructor
  }

  $set(props: any): void {
    // Mock props setter
  }

  $destroy(): void {
    // Mock destroy method
  }

  $on(event: string, handler: Function): void {
    // Mock event listener
  }
}
