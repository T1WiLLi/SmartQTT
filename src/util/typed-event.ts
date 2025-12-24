export class TypedEvent<TEvents extends Record<string, any>> {
    private listeners = new Map<keyof TEvents, Set<(e: any) => void>>();

    on<K extends keyof TEvents>(event: K, fn: (e: TEvents[K]) => void): () => void {
        let set = this.listeners.get(event);
        if (!set) {
            set = new Set();
            this.listeners.set(event, set);
        }
        set.add(fn as any);
        return () => this.off(event, fn);
    }

    off<K extends keyof TEvents>(event: K, fn: (e: TEvents[K]) => void): void {
        this.listeners.get(event)?.delete(fn as any);
    }

    emit<K extends keyof TEvents>(event: K, payload: TEvents[K]): void {
        const set = this.listeners.get(event);
        if (!set) {
            return;
        }

        for (const fn of set) {
            try {
                (fn as any)(payload);
            } catch {
                // Swallow
            }
        }
    }

    clear(): void {
        this.listeners.clear();
    }
}