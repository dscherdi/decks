// Mock for Svelte runtime in unit tests

export function mount(component: any, options: any) {
  return {
    $set: (props: any) => {},
    $destroy: () => {},
    $on: (event: string, handler: Function) => {},
  };
}

export function unmount(component: any) {
  // Mock unmount
}

export function createEventDispatcher() {
  return (event: string, detail?: any) => {
    // Mock event dispatcher
  };
}
