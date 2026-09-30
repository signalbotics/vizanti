import { mapToRGBA } from '../geometry/map.js';

self.onmessage = (event) => {
	const { seq, data, width, height, scheme, maxSize } = event.data;
	const result = mapToRGBA(data, width, height, scheme, maxSize);
	if (result.error)
		self.postMessage({ seq, error: result.error });
	else
		self.postMessage({ seq, ...result }, [result.rgba.buffer]);
};
