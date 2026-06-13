import { describe, expect, it } from 'vitest';
import { transformTemplateVars } from './test-utils/transform.js';

describe('templateVarsController', () => {
	it('adds context and config destructuring to components without params', () => {
		const result = transformTemplateVars(`
			const App = () => {
				return <div>Static</div>;
			};
			App.templateVars = [ 'title' ];
		`, { language: 'handlebars' });

		expect(result.code).toMatch(/const App = \(\{\s+__context__,\s+__config__\s+\}\)/);
	});

	it('reads context and config from identifier props params', () => {
		const result = transformTemplateVars(`
			const App = (props) => {
				return <h1>{ props.title }</h1>;
			};
			App.templateVars = [ 'title' ];
		`, { language: 'php' });

		expect(result.code).toContain("typeof props.__context__ === 'number' ? props.__context__ : 0");
		expect(result.code).toContain("typeof props.__config__ !== 'undefined' ? props.__config__ : {}");
	});

	it('injects context and config into child components', () => {
		const result = transformTemplateVars(`
			const Child = ({ label }) => {
				return <span>{ label }</span>;
			};

			const App = ({ label }) => {
				return <Child label={ label } />;
			};
			App.templateVars = [ 'label' ];
		`, { language: 'handlebars' });

		expect(result.code).toContain('__context__: _uid');
		expect(result.code).toContain('__config__: _uid');
	});

	it('increments child context when components render inside list maps', () => {
		const result = transformTemplateVars(`
			const Child = ({ label }) => {
				return <span>{ label }</span>;
			};

			const App = ({ items }) => {
				return <>{ items.map((item) => <Child label={ item.label } />) }</>;
			};
			App.templateVars = [
				'items[].label',
			];
		`, { language: 'handlebars' });

		expect(result.code).toMatch(/__context__: _uid\d* \+ 1/);
	});

	it('copies input value attrs to jsxtv_value for later scraping', () => {
		const result = transformTemplateVars(`
			const App = ({ email }) => {
				return <input type="email" value={ email } />;
			};
			App.templateVars = [ 'email' ];
		`, { language: 'handlebars' });

		expect(result.code).toContain('jsxtv_value');
	});

	it('adds recursion guards after hooks have been called', () => {
		const result = transformTemplateVars(`
			const App = ({ title }) => {
				const [ value ] = useState(title);
				useEffect(() => {}, []);
				return <h1>{ value }</h1>;
			};
			App.templateVars = [ 'title' ];
		`, { language: 'php' });

		const useEffectIndex = result.code.indexOf('useEffect');
		const guardIndex = result.code.indexOf('> 20');
		const returnIndex = result.code.indexOf('return h("h1"');

		expect(useEffectIndex).toBeGreaterThan(-1);
		expect(guardIndex).toBeGreaterThan(useEffectIndex);
		expect(returnIndex).toBeGreaterThan(guardIndex);
	});
});
