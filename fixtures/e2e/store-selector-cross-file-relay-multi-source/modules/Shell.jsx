import { Header } from './Header.jsx';

export const Shell = ({ hero }) => (
	<section>
		<p>{ hero.subtitle }</p>
		<Header hero={ hero } />
	</section>
);
